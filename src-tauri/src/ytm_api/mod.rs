pub mod types;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::OnceCell;

use crate::state::player::TrackInfo;
use crate::webview_bridge::api::ytm_api_call;

use self::types::*;

/// Rust-side cache + in-flight de-dupe for `/next` responses, keyed
/// by request body (videoId+playlistId combination).
///
/// Why this exists: the YTM webview bridge stalls for ~3-15 s during
/// a track-change navigation. With four commands each issuing their
/// own /next fetch per track change (lyrics, lyrics-counterpart,
/// audio-counterpart artwork, upcoming-tracks), the bridge channel
/// saturates and they all time out together.
///
/// Strategy:
///   * **In-flight de-dupe** — concurrent calls for the same body
///     share a single fetch via `tokio::sync::OnceCell`. The first
///     caller runs the closure; subsequent callers await the same
///     Future and receive the cached result.
///   * **TTL** — once filled, the OnceCell is reused for `NEXT_CACHE_TTL`.
///     After expiry it's evicted on next access so the next caller
///     creates a fresh cell.
///   * **Failure transparency** — `get_or_try_init` does NOT cache on
///     error, so a transient bridge timeout doesn't poison the entry;
///     the next caller retries.
const NEXT_CACHE_TTL: Duration = Duration::from_secs(45);

type NextCell = Arc<OnceCell<Value>>;

pub struct YtmApi {
    next_cache: Mutex<HashMap<String, (Instant, NextCell)>>,
}

impl YtmApi {
    pub fn new() -> Self {
        Self {
            next_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Fetch a `/next` response for `body`, using the cache + in-flight
    /// de-dupe described on `NEXT_CACHE_TTL`. The returned `Value` is a
    /// clone of the cached entry — callers can mutate freely.
    async fn fetch_next_cached(
        &self,
        app: &AppHandle,
        body: &str,
    ) -> anyhow::Result<Value> {
        let cell = self.acquire_next_cell(body);
        let value = cell
            .get_or_try_init(|| async {
                let raw = ytm_api_call(app, "next", body)
                    .await
                    .map_err(anyhow::Error::msg)?;
                let parsed: Value = serde_json::from_str(&raw)?;
                Ok::<_, anyhow::Error>(parsed)
            })
            .await?;
        Ok(value.clone())
    }

    /// Get-or-create the OnceCell for a body. Evicts expired entries
    /// during the same lock to keep the map bounded; this is cheap
    /// because the map only grows by one entry per distinct request
    /// body within the TTL window.
    fn acquire_next_cell(&self, body: &str) -> NextCell {
        let mut guard = self.next_cache.lock().expect("next_cache poisoned");
        let now = Instant::now();
        guard.retain(|_, (ts, cell)| {
            // Keep entries that are still inside their TTL window AND
            // have already produced a value. If the cell is empty (the
            // initial fetch is still in flight or it failed), keep it
            // briefly so concurrent followers can still attach.
            let fresh = now.duration_since(*ts) < NEXT_CACHE_TTL;
            fresh || cell.get().is_none()
        });
        if let Some((_, cell)) = guard.get(body) {
            return cell.clone();
        }
        let cell: NextCell = Arc::new(OnceCell::new());
        guard.insert(body.to_string(), (now, cell.clone()));
        cell
    }

    /// Fetch up to N autocomplete suggestions for a partial query.
    pub async fn search_suggestions(
        &self,
        app: &AppHandle,
        query: &str,
    ) -> anyhow::Result<Vec<String>> {
        let body = serde_json::json!({ "input": query }).to_string();
        let raw = ytm_api_call(app, "music/get_search_suggestions", &body)
            .await
            .map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        Ok(parse_search_suggestions(&data))
    }

    /// Search for songs, albums, artists, and playlists via the real YTM API.
    pub async fn search(
        &self,
        app: &AppHandle,
        query: &str,
        filter: Option<String>,
    ) -> anyhow::Result<SearchResults> {
        let mut body = serde_json::json!({ "query": query });
        if let Some(ref params) = filter {
            body["params"] = serde_json::Value::String(params.clone());
        }
        let raw = ytm_api_call(app, "search", &body.to_string()).await.map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        let results = parse_search_results(&data, filter.as_deref());
        Ok(results)
    }

    /// Fetch home page shelves with recommended content via the real YTM API.
    pub async fn get_home(&self, app: &AppHandle) -> anyhow::Result<Vec<Shelf>> {
        let body = serde_json::json!({ "browseId": "FEmusic_home" }).to_string();
        let raw = ytm_api_call(app, "browse", &body).await.map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        let mut shelves = parse_home_shelves(&data);

        // Follow continuation tokens to load more sections
        let mut continuation = extract_continuation(&data);
        let mut attempts = 0;
        while let Some(token) = continuation {
            if attempts >= 5 {
                break;
            }
            attempts += 1;
            tracing::info!(attempts, "fetching home continuation");

            let cont_body = serde_json::json!({ "continuation": token }).to_string();
            let cont_endpoint = "browse";
            match ytm_api_call(app, cont_endpoint, &cont_body).await {
                Ok(cont_raw) => {
                    if let Ok(cont_data) = serde_json::from_str::<Value>(&cont_raw) {
                        let more = parse_continuation_shelves(&cont_data);
                        tracing::info!(new_shelves = more.len(), "continuation loaded");
                        shelves.extend(more);
                        continuation = extract_continuation_token(&cont_data);
                    } else {
                        break;
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "continuation failed");
                    break;
                }
            }
        }

        Ok(shelves)
    }

    /// Fetch playlist detail (title, artwork, tracks) via the real YTM API.
    pub async fn get_playlist(
        &self,
        app: &AppHandle,
        playlist_id: &str,
    ) -> anyhow::Result<PlaylistDetail> {
        // Album IDs (MPRE...) and Show / Podcast IDs (MPSP...) must NOT
        // have a VL prefix — YTM's `browse` endpoint expects them raw.
        // Playlist IDs (RDCLAK, PL, OLAK, etc.) MUST have a VL prefix.
        let browse_id = if playlist_id.starts_with("VL")
            || playlist_id.starts_with("MPRE")
            || playlist_id.starts_with("MPSP")
        {
            playlist_id.to_string()
        } else {
            format!("VL{}", playlist_id)
        };
        tracing::info!(original = %playlist_id, browse_id = %browse_id, "get_playlist browse_id");
        let body = serde_json::json!({ "browseId": browse_id }).to_string();
        let raw = ytm_api_call(app, "browse", &body)
            .await
            .map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        Ok(parse_playlist_detail(&data, playlist_id))
    }

    /// Fetch explore page shelves via the real YTM API.
    pub async fn get_explore(&self, app: &AppHandle) -> anyhow::Result<Vec<Shelf>> {
        let body = serde_json::json!({ "browseId": "FEmusic_explore" }).to_string();
        let raw = ytm_api_call(app, "browse", &body).await.map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        let mut shelves = parse_explore_shelves(&data);

        // Follow continuations for explore page too
        let mut continuation = extract_continuation(&data);
        let mut attempts = 0;
        while let Some(token) = continuation {
            if attempts >= 3 {
                break;
            }
            attempts += 1;
            let cont_body = serde_json::json!({ "continuation": token }).to_string();
            match ytm_api_call(app, "browse", &cont_body).await {
                Ok(cont_raw) => {
                    match serde_json::from_str::<Value>(&cont_raw) {
                        Ok(cont_data) => {
                            let more = parse_continuation_shelves(&cont_data);
                            shelves.extend(more);
                            continuation = extract_continuation_token(&cont_data);
                        }
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                "explore continuation JSON parse failed — partial results returned"
                            );
                            break;
                        }
                    }
                }
                Err(e) => {
                    // Mirrors `get_home`'s logging pattern. Without this,
                    // a network failure during Explore continuation loads
                    // silent partial results with no diagnostic signal.
                    tracing::warn!(error = %e, "explore continuation fetch failed");
                    break;
                }
            }
        }

        Ok(shelves)
    }

    /// Fetch user's library playlists via the real YTM API.
    pub async fn get_library_playlists(
        &self,
        app: &AppHandle,
    ) -> anyhow::Result<Vec<PlaylistSummary>> {
        let body = serde_json::json!({ "browseId": "FEmusic_liked_playlists" }).to_string();
        let raw = ytm_api_call(app, "browse", &body).await.map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        Ok(parse_library_playlists(&data))
    }

    /// Fetch user's liked/library songs via the real YTM API.
    pub async fn get_library_songs(
        &self,
        app: &AppHandle,
    ) -> anyhow::Result<Vec<TrackInfo>> {
        let body = serde_json::json!({ "browseId": "FEmusic_liked_videos" }).to_string();
        let raw = ytm_api_call(app, "browse", &body).await.map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        Ok(parse_library_songs(&data))
    }

    /// Fetch user's liked/library albums via the real YTM API.
    pub async fn get_library_albums(
        &self,
        app: &AppHandle,
    ) -> anyhow::Result<Vec<AlbumSummary>> {
        let body = serde_json::json!({ "browseId": "FEmusic_liked_albums" }).to_string();
        let raw = ytm_api_call(app, "browse", &body).await.map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        Ok(parse_library_albums(&data))
    }

    /// Fetch user's library artists via the real YTM API.
    pub async fn get_library_artists(
        &self,
        app: &AppHandle,
    ) -> anyhow::Result<Vec<ArtistSummary>> {
        let body = serde_json::json!({ "browseId": "FEmusic_library_corpus_track_artists" }).to_string();
        let raw = ytm_api_call(app, "browse", &body).await.map_err(anyhow::Error::msg)?;
        let data: Value = serde_json::from_str(&raw)?;
        Ok(parse_library_artists(&data))
    }

    /// Add a playlist to the signed-in user's library ("Saved playlists").
    /// Uses the YTM like endpoint with the playlist as the target — the same
    /// call the YTM web UI's save button makes, which adds the playlist to
    /// FEmusic_liked_playlists (issues #46, #54).
    pub async fn save_playlist_to_library(
        &self,
        app: &AppHandle,
        playlist_id: &str,
    ) -> anyhow::Result<()> {
        let body = serde_json::json!({
            "target": { "playlistId": playlist_id }
        })
        .to_string();
        let raw = ytm_api_call(app, "like/like", &body)
            .await
            .map_err(anyhow::Error::msg)?;
        check_like_response(&raw, "like")
    }

    /// Remove a playlist from the signed-in user's library. Mirror of
    /// `save_playlist_to_library`.
    pub async fn remove_playlist_from_library(
        &self,
        app: &AppHandle,
        playlist_id: &str,
    ) -> anyhow::Result<()> {
        let body = serde_json::json!({
            "target": { "playlistId": playlist_id }
        })
        .to_string();
        let raw = ytm_api_call(app, "like/removelike", &body)
            .await
            .map_err(anyhow::Error::msg)?;
        check_like_response(&raw, "removelike")
    }

    /// Fetch lyrics for a track. Two-step flow: `next` with the videoId
    /// surfaces a tabs list; the "Lyrics" tab carries a `browseId` that
    /// returns the actual lyrics text via a second `browse` call.
    ///
    /// When YTM ships only plain text (the common case), a fallback hop to
    /// the public LRCLIB database supplies per-line timings — required for
    /// the highlight-and-scroll-with-playback UX.
    /// When `force_external` is true, skip the "YTM has synced lines →
    /// return YTM" short-circuit and go straight to the LRCLIB/NetEase
    /// race. Used by the Refresh-lyrics affordance when YTM's lyrics tab
    /// itself returns the wrong song's content.
    pub async fn get_lyrics(
        &self,
        app: &AppHandle,
        video_id: &str,
        artist: Option<&str>,
        title: Option<&str>,
        duration_secs: Option<f64>,
        force_external: bool,
    ) -> anyhow::Result<Lyrics> {
        // Always look up lyrics for the AUDIO counterpart, never the music
        // video. YTM matches every official music video to its audio track
        // (`MUSIC_VIDEO_TYPE_ATV`); the audio side carries the real lyric
        // tab — many music-video pages don't expose one at all. We grab
        // the counterpart videoId from the first /next response and, if
        // it differs from the playing video, re-issue /next against it
        // before extracting the lyrics browseId.
        let next_body = serde_json::json!({ "videoId": video_id }).to_string();
        let mut next_data = self.fetch_next_cached(app, &next_body).await?;

        // Audio-counterpart metadata (artist / title / duration) overrides
        // anything the bridge captured from the music-video page. Music
        // video titles are noisy ("Stayin' Alive (Official Music Video)
        // [4K Remastered]" etc.) and corrupt LRCLIB queries. The
        // counterpart's title/byline is the clean song version. Pulled
        // from the SAME /next response — no extra bridge call.
        let mut effective_artist: Option<String> = artist.map(str::to_string);
        let mut effective_title: Option<String> = title.map(str::to_string);
        let mut effective_duration: Option<f64> = duration_secs;
        if let Some(meta) = extract_audio_counterpart_meta(&next_data, video_id) {
            tracing::info!(
                video_id,
                clean_title = %meta.title,
                clean_artist = %meta.artist,
                "lyrics lookup: using audio counterpart's track metadata"
            );
            if !meta.title.is_empty() {
                effective_title = Some(meta.title);
            }
            if !meta.artist.is_empty() {
                effective_artist = Some(meta.artist);
            }
            if meta.duration_secs > 0.0 {
                effective_duration = Some(meta.duration_secs);
            }
        }

        if let Some(audio_vid) = extract_audio_counterpart_video_id(&next_data, video_id) {
            if audio_vid != video_id {
                tracing::info!(
                    video_id,
                    audio_video_id = %audio_vid,
                    "lyrics lookup: switched from music video to audio counterpart"
                );
                let alt_body = serde_json::json!({ "videoId": &audio_vid }).to_string();
                if let Ok(alt_data) = self.fetch_next_cached(app, &alt_body).await {
                    next_data = alt_data;
                }
            }
        }

        let browse_id = extract_lyrics_browse_id(&next_data).ok_or_else(|| {
            anyhow::anyhow!("YTM did not expose a lyrics tab for this track")
        })?;

        let browse_body = serde_json::json!({ "browseId": browse_id }).to_string();
        let browse_raw = ytm_api_call(app, "browse", &browse_body)
            .await
            .map_err(anyhow::Error::msg)?;
        let browse_data: Value = serde_json::from_str(&browse_raw)?;
        let mut lyrics = parse_lyrics(&browse_data);

        // YTM already shipped synced lines — use them and skip external
        // sources, UNLESS the caller explicitly forced an external lookup
        // (the Refresh button — user is telling us "YTM has the wrong
        // lyrics, please try LRCLIB/NetEase instead"). When forced we
        // discard YTM's synced lines and the plain text and fall through
        // to the race below; the LRCLIB/NetEase result becomes the new
        // baseline that gets cached.
        if !force_external && lyrics.lines.as_ref().map_or(false, |l| !l.is_empty()) {
            // YTM's lyrics tab has no per-track verification; we record the
            // playing track's metadata so a later cache-read sanity check
            // can spot a divergence (e.g. videoId got re-bound to a
            // different audio counterpart on YTM's side).
            lyrics.matched_artist = effective_artist.clone();
            lyrics.matched_title = effective_title.clone();
            return Ok(lyrics);
        }
        if force_external {
            tracing::info!(
                video_id,
                "force_external=true — discarding YTM lyrics tab and racing LRCLIB/NetEase"
            );
            lyrics.lines = None;
            lyrics.text = String::new();
        }

        // YTM returned an empty lyrics tab. Earlier we treated this as a
        // hard "no lyrics" signal to avoid pasting the vocal version's
        // lyrics onto a piano cover. Reality is messier: YTM also returns
        // empty for plenty of regular tracks ("Love Love Love" by Jolin
        // Tsai, etc.) where the audio counterpart's lyrics page just
        // hasn't been populated. False negative is more common than the
        // false positive we were defending against.
        //
        // New rule: only skip external sources when the title itself
        // signals an instrumental / cover (looks like "Instrumental",
        // "Karaoke", "Piano Cover", etc.). Otherwise fall through and
        // let LRCLIB/NetEase try.
        let has_plain_text = !lyrics.text.trim().is_empty();
        let title_for_check = effective_title.as_deref().unwrap_or("");
        if !has_plain_text && looks_like_instrumental(title_for_check) {
            tracing::info!(
                video_id,
                title = %title_for_check,
                "YTM reported no lyrics — title suggests instrumental, skipping external sync lookup"
            );
            return Ok(lyrics);
        }

        // Diagnostic — every prior session showed `force_external=true`
        // logging followed by silence. Confirming what the race actually
        // sees so we know if it's running or being short-circuited.
        tracing::info!(
            video_id,
            effective_artist = ?effective_artist,
            effective_title = ?effective_title,
            effective_duration = ?effective_duration,
            "lyrics: about to race LRCLIB/NetEase"
        );
        if let (Some(artist), Some(title)) = (effective_artist.as_deref(), effective_title.as_deref()) {
            if artist.trim().is_empty() || title.trim().is_empty() {
                tracing::warn!(
                    video_id,
                    artist_len = artist.len(),
                    title_len = title.len(),
                    "lyrics: artist or title is empty — race would be useless, skipping"
                );
            }
            let clean_artist = clean_query_field(artist);
            let clean_title = clean_query_field(title);
            tracing::info!(
                video_id,
                clean_artist = %clean_artist,
                clean_title = %clean_title,
                "lyrics: cleaned query fields"
            );
            let lookup_duration = effective_duration;

            // Race LRCLIB and NetEase in parallel. Whichever returns synced
            // lyrics first wins; `None` results wait for the other source
            // before giving up. Different sources win on different catalogs
            // (LRCLIB for Western, NetEase for CJK), so racing halves the
            // typical wait instead of trying them one after the other.
            let artist_l = clean_artist.clone();
            let title_l = clean_title.clone();
            let vid_l = video_id.to_string();
            let lrc_fut = async move {
                tracing::info!(video_id = %vid_l, "LRCLIB: about to call fetch_lrclib_synced");
                let r = fetch_lrclib_synced(&artist_l, &title_l, lookup_duration).await;
                tracing::info!(video_id = %vid_l, ok = r.is_ok(), "LRCLIB: fetch_lrclib_synced returned");
                match r {
                    Ok(Some(body)) => {
                        tracing::info!(video_id = %vid_l, body_len = body.len(), "LRCLIB: returning Some");
                        Some((body, "LRCLIB"))
                    }
                    Ok(None) => {
                        tracing::info!(video_id = %vid_l, "LRCLIB had no synced lyrics");
                        None
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "LRCLIB fetch failed");
                        None
                    }
                }
            };

            let artist_n = clean_artist.clone();
            let title_n = clean_title.clone();
            let vid_n = video_id.to_string();
            let ne_fut = async move {
                tracing::info!(video_id = %vid_n, "NetEase: about to call fetch_netease_synced");
                let r = fetch_netease_synced_with_duration(
                    &artist_n,
                    &title_n,
                    lookup_duration,
                )
                .await;
                tracing::info!(video_id = %vid_n, ok = r.is_ok(), "NetEase: fetch_netease_synced returned");
                match r {
                    Ok(Some(body)) => {
                        tracing::info!(video_id = %vid_n, body_len = body.len(), "NetEase: returning Some");
                        Some((body, "NetEase"))
                    }
                    Ok(None) => {
                        tracing::info!(video_id = %vid_n, "NetEase had no synced lyrics");
                        None
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "NetEase fetch failed");
                        None
                    }
                }
            };

            tokio::pin!(lrc_fut, ne_fut);
            let mut lrc_done = false;
            let mut ne_done = false;
            let mut winner: Option<(String, &'static str)> = None;

            while winner.is_none() && !(lrc_done && ne_done) {
                tokio::select! {
                    r = &mut lrc_fut, if !lrc_done => {
                        lrc_done = true;
                        if r.is_some() { winner = r; }
                    }
                    r = &mut ne_fut, if !ne_done => {
                        ne_done = true;
                        if r.is_some() { winner = r; }
                    }
                }
            }

            if let Some((body, source_name)) = winner {
                if apply_synced_lrc(&mut lyrics, &body, source_name) {
                    // Stamp the matched artist/title we asked for. The
                    // fetch helpers already filtered candidates to ensure
                    // the response is FOR this track (NetEase by title +
                    // artist + duration; LRCLIB by duration tolerance), so
                    // recording the requested values gives the cache-read
                    // sanity check a stable point of comparison even when
                    // the user's playing-track metadata refines later.
                    lyrics.matched_artist = effective_artist.clone();
                    lyrics.matched_title = effective_title.clone();
                    return Ok(lyrics);
                }
            }
        }

        Ok(lyrics)
    }

    /// Fetch the upcoming tracks for a given videoId by calling YTM's
    /// `next` endpoint and parsing its queue panel. Used to warm the
    /// lyrics cache for songs the user will play in a few seconds and to
    /// populate the playing-queue panel. When `playlist_id` is provided
    /// YTM returns the full playlist/album queue; without it, the response
    /// is the auto-generated song-radio seeded on the videoId alone.
    pub async fn get_upcoming_tracks(
        &self,
        app: &AppHandle,
        video_id: &str,
        limit: usize,
        playlist_id: Option<&str>,
    ) -> anyhow::Result<Vec<TrackInfo>> {
        let body = match playlist_id {
            Some(list) if !list.is_empty() => {
                serde_json::json!({ "videoId": video_id, "playlistId": list }).to_string()
            }
            _ => serde_json::json!({ "videoId": video_id }).to_string(),
        };
        let data = self.fetch_next_cached(app, &body).await?;
        Ok(extract_upcoming_tracks(&data, video_id, limit))
    }

    /// Fetch the audio counterpart's album-art URL for a given videoId.
    /// Used to swap the music-video 16:9 frame the bridge captured for
    /// the song's square album cover. See
    /// `extract_audio_counterpart_thumbnail` for the JSON shape.
    pub async fn get_audio_counterpart_artwork(
        &self,
        app: &AppHandle,
        video_id: &str,
    ) -> anyhow::Result<Option<String>> {
        let body = serde_json::json!({ "videoId": video_id }).to_string();
        let data = self.fetch_next_cached(app, &body).await?;
        Ok(extract_audio_counterpart_thumbnail(&data, video_id))
    }
}

/// Mutate `lyrics` in-place with parsed LRC data from an external source.
/// Returns `true` when timed lines were successfully adopted.
fn apply_synced_lrc(lyrics: &mut Lyrics, lrc: &str, source_name: &str) -> bool {
    let parsed = parse_lrc(lrc);
    if parsed.is_empty() {
        return false;
    }
    lyrics.text = parsed
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    lyrics.lines = Some(parsed);
    let existing = lyrics.source.take();
    lyrics.source = Some(match existing {
        Some(s) if !s.is_empty() => format!("{s} · Synced by {source_name}"),
        _ => format!("Synced by {source_name}"),
    });
    true
}

/// Strip common YouTube-title noise that kills exact-match lookups on
/// LRCLIB / NetEase: parenthesized "Official MV" markers, bracketed tags,
/// full-width Chinese brackets, and a trailing `- My Secret` translation.
fn clean_query_field(s: &str) -> String {
    // Noise tokens we strip when they appear inside any bracket pair. Match
    // case-insensitively; any bracket whose lowercased inner text contains
    // one of these tokens gets dropped wholesale.
    const NOISE_TOKENS: &[&str] = &[
        "official", "mv", "music video", "audio", "lyric", "visualizer",
        "hd", "hq", "remix", "cover", "live", "版", "版本",
    ];

    let noise_pairs: &[(char, char)] = &[('(', ')'), ('[', ']'), ('【', '】'), ('〈', '〉')];
    let mut out = s.to_string();

    for (open, close) in noise_pairs {
        out = strip_noise_brackets(&out, *open, *close, NOISE_TOKENS);
    }

    // Cut at " - " dash-tail (translations, "- My Secret", etc.) only when
    // the part before it is meaningfully long.
    if let Some(idx) = out.find(" - ") {
        let head = &out[..idx];
        if head.trim().chars().count() >= 2 {
            out = head.to_string();
        }
    }

    // Collapse internal whitespace runs so the remote query encodes cleanly.
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Remove every `open..close` pair whose contents contain any of the given
/// lowercase noise tokens. Tolerant of mismatched / unbalanced brackets
/// (just returns the tail unchanged when it can't find a close).
fn strip_noise_brackets(
    s: &str,
    open: char,
    close: char,
    noise_tokens: &[&str],
) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find(open) {
        out.push_str(&rest[..pos]);
        let after_open = &rest[pos + open.len_utf8()..];
        let Some(end_off) = after_open.find(close) else {
            // No closing bracket; keep the open char and everything else.
            out.push(open);
            out.push_str(after_open);
            return out;
        };
        let inner = &after_open[..end_off];
        let lower = inner.to_lowercase();
        let is_noise = noise_tokens.iter().any(|t| lower.contains(t));
        if !is_noise {
            // Keep non-noise brackets verbatim.
            out.push(open);
            out.push_str(inner);
            out.push(close);
        }
        rest = &after_open[end_off + close.len_utf8()..];
    }
    out.push_str(rest);
    out
}

/// Maximum tolerated drift between YTM's reported track length and LRCLIB's
/// recorded length, in seconds. Tracks whose duration disagrees by more than
/// this are almost certainly a different recording (album vs single mix,
/// live vs studio, edit vs extended) — the LRC timestamps would be anchored
/// to a different zero, producing systematic per-track off-sync.
const LRCLIB_DURATION_TOLERANCE_SECS: f64 = 2.0;

/// Ask LRCLIB (https://lrclib.net) for synced LRC-format lyrics. Returns the
/// raw LRC body on success, `None` when LRCLIB has no match (or no match
/// within duration tolerance), `Err` on transport failure. LRCLIB is a free,
/// open, community-maintained database of synced lyrics keyed by
/// artist/track/duration.
///
/// We use `/api/search` over `/api/get` so we can iterate every candidate
/// match and reject those whose duration disagrees with YTM's by more than
/// `LRCLIB_DURATION_TOLERANCE_SECS`. `/api/get` returns the single
/// best-effort match, which can be wrong-recording when the catalog has
/// multiple variants (e.g. radio edit vs album cut) sharing the same
/// title/artist.
async fn fetch_lrclib_synced(
    artist: &str,
    title: &str,
    duration_secs: Option<f64>,
) -> anyhow::Result<Option<String>> {
    // LRCLIB can take 5-8s to respond for CJK/less-indexed queries. A
    // tight timeout is why Chinese tracks were falling through to NetEase.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    // No duration → fall back to the single-result endpoint without
    // strict matching (best we can do). Most YTM tracks expose duration.
    let target_duration = match duration_secs.filter(|d| *d > 0.0) {
        Some(d) => d,
        None => {
            return fetch_lrclib_get(&client, artist, title, None).await;
        }
    };

    let resp = client
        .get("https://lrclib.net/api/search")
        .query(&[
            ("artist_name", artist),
            ("track_name", title),
        ])
        .header(
            "User-Agent",
            "VibeYTM/0.9.0 (https://github.com/dongli/VibeYTM)",
        )
        .send()
        .await?;

    if !resp.status().is_success() {
        anyhow::bail!("LRCLIB search returned HTTP {}", resp.status());
    }
    let candidates: Vec<Value> = resp.json().await?;

    // Pick the candidate whose recorded duration is closest to YTM's, but
    // only if it falls inside the tolerance window. Anything further away
    // is a different recording with mismatched timing.
    let mut best: Option<(f64, &Value)> = None;
    for cand in &candidates {
        let cand_dur = cand
            .get("duration")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if cand_dur <= 0.0 {
            continue;
        }
        let diff = (cand_dur - target_duration).abs();
        if diff > LRCLIB_DURATION_TOLERANCE_SECS {
            continue;
        }
        // Reject instrumentals — they have no useful synced timing.
        if cand
            .get("instrumental")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        let synced = cand
            .get("syncedLyrics")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if synced.is_empty() {
            continue;
        }
        if best.map_or(true, |(prev_diff, _)| diff < prev_diff) {
            best = Some((diff, cand));
        }
    }

    if let Some((_, cand)) = best {
        if let Some(synced) = cand.get("syncedLyrics").and_then(|v| v.as_str()) {
            tracing::info!(
                artist = %artist,
                title = %title,
                target = %target_duration,
                "LRCLIB matched within duration tolerance"
            );
            return Ok(Some(synced.to_string()));
        }
    }

    tracing::info!(
        artist = %artist,
        title = %title,
        target = %target_duration,
        candidates = candidates.len(),
        "LRCLIB had no candidate within duration tolerance"
    );
    Ok(None)
}

/// Single-track fetch via LRCLIB's `/api/get`. Used only when the caller
/// has no duration to verify against — LRCLIB's own server-side match is
/// then the only check we have.
async fn fetch_lrclib_get(
    client: &reqwest::Client,
    artist: &str,
    title: &str,
    duration_secs: Option<f64>,
) -> anyhow::Result<Option<String>> {
    let mut query: Vec<(&str, String)> = vec![
        ("artist_name", artist.to_string()),
        ("track_name", title.to_string()),
    ];
    if let Some(d) = duration_secs.filter(|d| *d > 0.0) {
        query.push(("duration", (d.round() as u64).to_string()));
    }
    let resp = client
        .get("https://lrclib.net/api/get")
        .query(&query)
        .header(
            "User-Agent",
            "VibeYTM/0.9.0 (https://github.com/dongli/VibeYTM)",
        )
        .send()
        .await?;
    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        anyhow::bail!("LRCLIB returned HTTP {}", resp.status());
    }
    let body: Value = resp.json().await?;
    if body
        .get("instrumental")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Ok(None);
    }
    let synced = body
        .get("syncedLyrics")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if synced.is_empty() {
        return Ok(None);
    }
    Ok(Some(synced.to_string()))
}

/// Ask NetEase Cloud Music for synced LRC-format lyrics. Does a two-call
/// lookup: search by "artist title" to find a song id, then fetch that
/// song's lyrics. NetEase has excellent coverage for Mandopop, Cantopop,
/// K-pop, J-pop, and a growing Western catalog. Free, no auth required.
async fn fetch_netease_synced(artist: &str, title: &str) -> anyhow::Result<Option<String>> {
    fetch_netease_synced_with_duration(artist, title, None).await
}

/// Like `fetch_netease_synced` but also requires the candidate's duration
/// to be within the same `LRCLIB_DURATION_TOLERANCE_SECS` window the LRCLIB
/// path uses, when a target duration is supplied. Reduces false positives
/// where NetEase has a *different* song with the same title.
async fn fetch_netease_synced_with_duration(
    artist: &str,
    title: &str,
    target_duration_secs: Option<f64>,
) -> anyhow::Result<Option<String>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()?;

    // Step 1: search. `s` is the query, `type=1` selects song results.
    let query = format!("{artist} {title}");
    let search_resp = client
        .get("https://music.163.com/api/search/get")
        .query(&[("s", query.as_str()), ("type", "1"), ("limit", "10")])
        .header("Referer", "https://music.163.com")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
             (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
        )
        .send()
        .await?;

    if !search_resp.status().is_success() {
        anyhow::bail!("NetEase search HTTP {}", search_resp.status());
    }
    let search_body: Value = search_resp.json().await?;
    let Some(songs) = search_body.pointer("/result/songs").and_then(|v| v.as_array()) else {
        return Ok(None);
    };

    // Score each candidate against the requested artist+title+duration.
    // Previous behaviour was a substring match on title only, with a
    // .or_else fallback to "the first result whatever it is" — that
    // returned wildly wrong lyrics whenever NetEase hadn't indexed the
    // requested song (e.g. brand-new releases like Jay Chou's 2026
    // "太陽之子" — NetEase's top hit was a completely unrelated track).
    //
    // New rule: require BOTH a title substring match AND an artist
    // substring match. When a target duration is supplied, also require
    // the candidate to be within tolerance. Drop the first-result
    // fallback entirely — better to surface "no lyrics" than to ship the
    // wrong song's text.
    let want_title = title.to_lowercase();
    let want_artist = artist.to_lowercase();
    let mut best: Option<(f64, u64)> = None;
    for s in songs {
        let name = s.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        let title_ok = !name.is_empty()
            && (name.contains(&want_title) || want_title.contains(&name));
        if !title_ok {
            continue;
        }
        let artist_ok = s
            .get("artists")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter().any(|a| {
                    let an = a
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_lowercase();
                    !an.is_empty()
                        && (an.contains(&want_artist) || want_artist.contains(&an))
                })
            })
            .unwrap_or(false);
        if !artist_ok {
            continue;
        }
        // NetEase's `duration` is in milliseconds.
        let cand_dur_ms = s.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if let Some(target) = target_duration_secs {
            if cand_dur_ms > 0.0 {
                let cand_secs = cand_dur_ms / 1000.0;
                let diff = (cand_secs - target).abs();
                if diff > LRCLIB_DURATION_TOLERANCE_SECS {
                    continue;
                }
                let id = match s.get("id").and_then(|v| v.as_u64()) {
                    Some(i) => i,
                    None => continue,
                };
                if best.map_or(true, |(prev, _)| diff < prev) {
                    best = Some((diff, id));
                }
                continue;
            }
        }
        // No target duration (or candidate has none) — accept the first
        // title+artist match in NetEase's relevance order.
        if best.is_none() {
            if let Some(id) = s.get("id").and_then(|v| v.as_u64()) {
                best = Some((f64::INFINITY, id));
            }
        }
    }

    let Some((_, song_id)) = best else {
        tracing::info!(
            artist = %artist,
            title = %title,
            target_duration_secs = ?target_duration_secs,
            "NetEase: no candidate passed title+artist+duration check"
        );
        return Ok(None);
    };

    // Step 2: fetch lyrics. `lv=1` asks for original LRC, `tv=-1` suppresses
    // the translation track (we render the native text).
    let lyric_resp = client
        .get("https://music.163.com/api/song/lyric")
        .query(&[
            ("id", song_id.to_string().as_str()),
            ("lv", "1"),
            ("tv", "-1"),
        ])
        .header("Referer", "https://music.163.com")
        .send()
        .await?;

    if !lyric_resp.status().is_success() {
        anyhow::bail!("NetEase lyric HTTP {}", lyric_resp.status());
    }
    let body: Value = lyric_resp.json().await?;
    let lrc = body
        .pointer("/lrc/lyric")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty() && s.contains('['));
    Ok(lrc.map(str::to_string))
}

/// Parse an LRC-format string into timed lines. LRC supports multiple
/// timestamps per line (for repeats) and `[mm:ss.xx]` or `[mm:ss]` forms.
/// Metadata headers like `[ar:Artist]` are treated as non-numeric and skipped.
fn parse_lrc(lrc: &str) -> Vec<LyricLine> {
    let mut out: Vec<LyricLine> = Vec::new();
    for raw in lrc.lines() {
        let mut stamps: Vec<u64> = Vec::new();
        let mut rest = raw;
        loop {
            let Some(open) = rest.find('[') else { break; };
            if open != 0 {
                break;
            }
            let Some(close) = rest[open + 1..].find(']') else { break; };
            let inner = &rest[open + 1..open + 1 + close];
            if let Some(ms) = parse_lrc_timestamp(inner) {
                stamps.push(ms);
            }
            rest = &rest[open + 1 + close + 1..];
        }
        if stamps.is_empty() {
            continue;
        }
        let text = rest.trim().to_string();
        for start_ms in stamps {
            out.push(LyricLine {
                start_ms,
                end_ms: None,
                text: text.clone(),
            });
        }
    }
    out.sort_by_key(|l| l.start_ms);

    // Fill end_ms from the next line's start so the UI can render line
    // durations if it wants. Keeps the last line open-ended.
    for i in 0..out.len().saturating_sub(1) {
        let next = out[i + 1].start_ms;
        out[i].end_ms = Some(next);
    }

    out
}

/// Parse an LRC-style timestamp. Accepts `mm:ss`, `mm:ss.xx`, `mm:ss.xxx`.
/// Returns milliseconds; `None` for non-numeric (e.g. metadata keys).
fn parse_lrc_timestamp(s: &str) -> Option<u64> {
    let (mins_str, rest) = s.split_once(':')?;
    let mins: u64 = mins_str.trim().parse().ok()?;
    let (secs_str, frac_str) = match rest.split_once('.') {
        Some((a, b)) => (a, Some(b)),
        None => (rest, None),
    };
    let secs: u64 = secs_str.trim().parse().ok()?;
    let frac_ms: u64 = match frac_str {
        Some(f) => {
            // "5" → 500 ms, "50" → 500 ms, "500" → 500 ms, "1234" → 123 ms
            let mut digits: String = f.chars().take(3).collect();
            while digits.len() < 3 {
                digits.push('0');
            }
            digits.parse().ok()?
        }
        None => 0,
    };
    Some(mins * 60_000 + secs * 1_000 + frac_ms)
}

/// YTM returns a minimal JSON body on success (responseContext + actions).
/// A failure surfaces as `{ "error": { "code": N, "message": "..." } }`.
/// Propagate that as an Err so the UI can roll back the optimistic toggle.
fn check_like_response(raw: &str, action: &str) -> anyhow::Result<()> {
    let parsed: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(action, error = %e, "could not parse like response; treating as success");
            return Ok(());
        }
    };
    if let Some(err) = parsed.get("error") {
        let code = err["code"].as_i64().unwrap_or(-1);
        let message = err["message"].as_str().unwrap_or("");
        tracing::error!(action, code, message, "YTM rejected like call");
        anyhow::bail!("YTM error {code}: {message}");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Response parsers — navigate deeply nested YTM API JSON
// ---------------------------------------------------------------------------

/// Category filter param constants for search.
#[allow(dead_code)]
const FILTER_SONGS: &str = "EgWKAQIIAWoSEA4QCRAKEAUQBBADEBUQEBAR";
const FILTER_ALBUMS: &str = "EgWKAQIYAWoSEA4QCRAKEAUQBBADEBUQEBAR";
const FILTER_ARTISTS: &str = "EgWKAQIgAWoSEA4QCRAKEAUQBBADEBUQEBAR";
#[allow(dead_code)]
const FILTER_VIDEOS: &str = "EgWKAQIQAWoSEA4QCRAKEAUQBBADEBUQEBAR";
const FILTER_PLAYLISTS: &str = "EgWKAQIoAWoSEA4QCRAKEAUQBBADEBUQEBAR";

/// Extract autocomplete suggestion strings from a `music/get_search_suggestions`
/// response. The response wraps each suggestion in a `searchSuggestionRenderer`
/// whose `suggestion.runs` carry the text fragments.
fn parse_search_suggestions(data: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let Some(sections) = data["contents"].as_array() else {
        return out;
    };
    for section in sections {
        let Some(items) = section["searchSuggestionsSectionRenderer"]["contents"].as_array()
        else {
            continue;
        };
        for item in items {
            let runs = &item["searchSuggestionRenderer"]["suggestion"]["runs"];
            let text = runs_text(runs);
            if !text.is_empty() && !out.iter().any(|s| s == &text) {
                out.push(text);
            }
            if out.len() >= 10 {
                return out;
            }
        }
    }
    out
}

fn parse_search_results(data: &Value, filter: Option<&str>) -> SearchResults {
    let mut songs = Vec::new();
    let mut albums = Vec::new();
    let mut artists = Vec::new();
    let mut playlists = Vec::new();
    let mut top_album: Option<AlbumSummary> = None;

    let tabs = &data["contents"]["tabbedSearchResultsRenderer"]["tabs"];
    let sections = tabs
        .get(0)
        .and_then(|t| t["tabRenderer"]["content"]["sectionListRenderer"]["contents"].as_array());

    let Some(sections) = sections else {
        return SearchResults { songs, albums, artists, playlists, top_album };
    };

    for section in sections {
        // Skip the top-result card shelf entirely — we don't use it.
        if section.get("musicCardShelfRenderer").is_some() {
            continue;
        }

        // musicShelfRenderer = the regular per-shelf list
        if let Some(shelf) = section.get("musicShelfRenderer") {
            if let Some(items) = shelf["contents"].as_array() {
                for item in items {
                    let renderer = &item["musicResponsiveListItemRenderer"];
                    if renderer.is_null() {
                        continue;
                    }

                    // While walking unfiltered results, collect every real
                    // album (browseId starts with `MPRE`) and keep the one
                    // with the latest year — that becomes the top album
                    // surfaced in the unified search view.
                    if filter.is_none() {
                        if let Some(album) = parse_album_from_list_item(renderer) {
                            if album.browse_id.starts_with("MPRE") {
                                let new_year = album
                                    .year
                                    .as_deref()
                                    .and_then(|y| y.parse::<u32>().ok())
                                    .unwrap_or(0);
                                let cur_year = top_album
                                    .as_ref()
                                    .and_then(|a| a.year.as_deref())
                                    .and_then(|y| y.parse::<u32>().ok())
                                    .unwrap_or(0);
                                if top_album.is_none() || new_year > cur_year {
                                    top_album = Some(album);
                                }
                            }
                        }
                    }

                    match filter {
                        Some(FILTER_ALBUMS) => {
                            if let Some(album) = parse_album_from_list_item(renderer) {
                                albums.push(album);
                            }
                        }
                        Some(FILTER_ARTISTS) => {
                            if let Some(artist) = parse_artist_from_list_item(renderer) {
                                artists.push(artist);
                            }
                        }
                        Some(FILTER_PLAYLISTS) => {
                            if let Some(pl) = parse_playlist_from_list_item(renderer) {
                                playlists.push(pl);
                            }
                        }
                        _ => {
                            // Songs, Videos, or no filter — parse as tracks
                            if let Some(track) = parse_track_from_list_item(renderer) {
                                songs.push(track);
                            }
                        }
                    }
                }
            }
        }
    }

    SearchResults { songs, albums, artists, playlists, top_album }
}

fn extract_continuation(data: &Value) -> Option<String> {
    data["contents"]["singleColumnBrowseResultsRenderer"]["tabs"]
        .get(0)?["tabRenderer"]["content"]["sectionListRenderer"]["continuations"]
        .get(0)?["nextContinuationData"]["continuation"]
        .as_str()
        .map(|s| s.to_string())
}

fn extract_continuation_token(data: &Value) -> Option<String> {
    // Continuation responses use continuationContents.sectionListContinuation
    data["continuationContents"]["sectionListContinuation"]["continuations"]
        .get(0)?["nextContinuationData"]["continuation"]
        .as_str()
        .map(|s| s.to_string())
}

fn parse_continuation_shelves(data: &Value) -> Vec<Shelf> {
    let mut shelves = Vec::new();
    let Some(sections) = data["continuationContents"]["sectionListContinuation"]["contents"].as_array() else {
        return shelves;
    };
    for section in sections {
        if let Some(obj) = section.as_object() {
            for (key, _) in obj {
                tracing::info!(section_type = %key, "continuation section type");
            }
        }
        if let Some(carousel) = section.get("musicCarouselShelfRenderer") {
            if let Some(shelf) = parse_carousel_shelf(carousel) {
                shelves.push(shelf);
            }
        }
    }
    shelves
}

/// Dispatch a `musicTwoRowItemRenderer` item into one of the typed buckets.
/// Checks for single-video cards FIRST (these have watchEndpoint.videoId).
fn dispatch_two_row_item(
    two_row: &Value,
    songs: &mut Vec<TrackInfo>,
    albums: &mut Vec<AlbumSummary>,
    playlists: &mut Vec<PlaylistSummary>,
    artists: &mut Vec<ArtistSummary>,
) {
    // 1. Single-video card: has watchEndpoint.videoId (not a collection)
    let watch_vid = two_row["navigationEndpoint"]["watchEndpoint"]["videoId"]
        .as_str()
        .unwrap_or_default();
    if !watch_vid.is_empty() {
        if let Some(track) = parse_track_from_two_row(two_row) {
            songs.push(track);
            return;
        }
    }

    // 2. Album: browseId starts with MPRE
    let browse_id = two_row["navigationEndpoint"]["browseEndpoint"]["browseId"]
        .as_str()
        .unwrap_or_default();

    if browse_id.starts_with("MPRE") {
        if let Some(album) = parse_album_from_two_row(two_row) {
            albums.push(album);
        }
        return;
    }

    // 3. Artist: browseId starts with UC or MPLA
    if browse_id.starts_with("UC") || browse_id.starts_with("MPLA") {
        if let Some(artist) = parse_artist_from_two_row(two_row) {
            artists.push(artist);
        }
        return;
    }

    // 4. Playlist: browseId starts with VL, or check overlay for playlistId
    if browse_id.starts_with("VL")
        || browse_id.starts_with("RDCLAK")
        || browse_id.starts_with("PL")
        || browse_id.starts_with("OLAK")
    {
        if let Some(pl) = parse_playlist_from_two_row(two_row) {
            playlists.push(pl);
        }
        return;
    }

    // 5. Check overlay play button for a playlist ID (e.g. "Today's biggest hits")
    let overlay_playlist = extract_playlist_id_from_two_row(two_row);
    if !overlay_playlist.is_empty() {
        if let Some(pl) = parse_playlist_from_two_row(two_row) {
            playlists.push(pl);
        }
        return;
    }

    // 6. Fallback: try album (may have no browseId and be dropped)
    if let Some(album) = parse_album_from_two_row(two_row) {
        albums.push(album);
    }
}

fn parse_carousel_shelf(carousel: &Value) -> Option<Shelf> {
    let title = extract_header_title(carousel);
    if title.is_empty() {
        return None;
    }

    let items = carousel["contents"].as_array()?;

    let mut song_items = Vec::new();
    let mut album_items = Vec::new();
    let mut playlist_items = Vec::new();
    let mut artist_items = Vec::new();

    for item in items {
        if let Some(two_row) = item.get("musicTwoRowItemRenderer") {
            dispatch_two_row_item(
                two_row,
                &mut song_items,
                &mut album_items,
                &mut playlist_items,
                &mut artist_items,
            );
        }
        if let Some(list_item) = item.get("musicResponsiveListItemRenderer") {
            if let Some(track) = parse_track_from_list_item(list_item) {
                song_items.push(track);
            }
        }
    }

    let content = if !song_items.is_empty() {
        ShelfContent::Songs(song_items)
    } else if !album_items.is_empty() {
        ShelfContent::Albums(album_items)
    } else if !playlist_items.is_empty() {
        ShelfContent::Playlists(playlist_items)
    } else if !artist_items.is_empty() {
        ShelfContent::Artists(artist_items)
    } else {
        return None;
    };

    Some(Shelf { title, items: content })
}

fn parse_home_shelves(data: &Value) -> Vec<Shelf> {
    let mut shelves = Vec::new();

    // Home response structure:
    // contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
    //   .sectionListRenderer.contents[].musicCarouselShelfRenderer
    let sections = data["contents"]["singleColumnBrowseResultsRenderer"]["tabs"]
        .get(0)
        .and_then(|t| t["tabRenderer"]["content"]["sectionListRenderer"]["contents"].as_array());

    let Some(sections) = sections else {
        return shelves;
    };

    tracing::info!(section_count = sections.len(), "parsing home sections");

    for section in sections {
        if let Some(obj) = section.as_object() {
            for (key, _) in obj {
                tracing::info!(section_type = %key, "home section type");
            }
        }

        if let Some(carousel) = section.get("musicCarouselShelfRenderer") {
            let title = extract_header_title(carousel);
            if title.is_empty() {
                continue;
            }

            let items = carousel["contents"].as_array();
            let Some(items) = items else { continue };

            let mut song_items = Vec::new();
            let mut album_items = Vec::new();
            let mut playlist_items = Vec::new();
            let mut artist_items = Vec::new();

            for item in items {
                if let Some(two_row) = item.get("musicTwoRowItemRenderer") {
                    dispatch_two_row_item(
                        two_row,
                        &mut song_items,
                        &mut album_items,
                        &mut playlist_items,
                        &mut artist_items,
                    );
                }

                // musicResponsiveListItemRenderer — songs
                if let Some(list_item) = item.get("musicResponsiveListItemRenderer") {
                    if let Some(track) = parse_track_from_list_item(list_item) {
                        song_items.push(track);
                    }
                }
            }

            // Pick the most populated content type for this shelf
            let content = if !song_items.is_empty() {
                ShelfContent::Songs(song_items)
            } else if !album_items.is_empty() {
                ShelfContent::Albums(album_items)
            } else if !playlist_items.is_empty() {
                ShelfContent::Playlists(playlist_items)
            } else if !artist_items.is_empty() {
                ShelfContent::Artists(artist_items)
            } else {
                continue;
            };

            shelves.push(Shelf { title, items: content });
        }
    }

    shelves
}

fn parse_library_playlists(data: &Value) -> Vec<PlaylistSummary> {
    let mut playlists = Vec::new();

    // Library playlists response structure:
    // contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
    //   .sectionListRenderer.contents[].gridRenderer.items[]
    //     .musicTwoRowItemRenderer
    // OR .itemSectionRenderer.contents[].gridRenderer...
    let sections = data["contents"]["singleColumnBrowseResultsRenderer"]["tabs"]
        .get(0)
        .and_then(|t| t["tabRenderer"]["content"]["sectionListRenderer"]["contents"].as_array());

    let Some(sections) = sections else {
        return playlists;
    };

    for section in sections {
        // Try gridRenderer directly
        let grid_items = section["gridRenderer"]["items"].as_array()
            .or_else(|| {
                section["musicShelfRenderer"]["contents"].as_array()
            })
            .or_else(|| {
                section["itemSectionRenderer"]["contents"]
                    .get(0)
                    .and_then(|c| c["gridRenderer"]["items"].as_array())
            });

        if let Some(items) = grid_items {
            for item in items {
                if let Some(two_row) = item.get("musicTwoRowItemRenderer") {
                    if let Some(pl) = parse_playlist_from_two_row(two_row) {
                        playlists.push(pl);
                    }
                }
            }
        }
    }

    playlists
}

/// Find list items from browse response by trying multiple known paths.
fn find_browse_list_items(data: &Value) -> Vec<&Value> {
    let paths = [
        // singleColumn path
        &data["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]["content"]["sectionListRenderer"]["contents"],
        // twoColumn path
        &data["contents"]["twoColumnBrowseResultsRenderer"]["secondaryContents"]["sectionListRenderer"]["contents"],
    ];

    let mut items = Vec::new();
    for path in paths {
        if let Some(sections) = path.as_array() {
            for section in sections {
                extract_items_from_section(section, &mut items);
                // Dig into itemSectionRenderer — library responses wrap shelves in it
                if let Some(inner) = section["itemSectionRenderer"]["contents"].as_array() {
                    for inner_item in inner {
                        extract_items_from_section(inner_item, &mut items);
                    }
                }
            }
        }
    }
    items
}

fn extract_items_from_section<'a>(section: &'a Value, out: &mut Vec<&'a Value>) {
    // musicShelfRenderer
    if let Some(shelf_items) = section["musicShelfRenderer"]["contents"].as_array() {
        out.extend(shelf_items.iter());
    }
    // musicPlaylistShelfRenderer
    if let Some(shelf_items) = section["musicPlaylistShelfRenderer"]["contents"].as_array() {
        out.extend(shelf_items.iter());
    }
    // gridRenderer
    if let Some(grid_items) = section["gridRenderer"]["items"].as_array() {
        out.extend(grid_items.iter());
    }
    // musicCarouselShelfRenderer
    if let Some(carousel_items) = section["musicCarouselShelfRenderer"]["contents"].as_array() {
        out.extend(carousel_items.iter());
    }
}

fn parse_library_songs(data: &Value) -> Vec<TrackInfo> {
    let items = find_browse_list_items(data);
    let mut tracks = Vec::new();
    for item in items {
        if let Some(renderer) = item.get("musicResponsiveListItemRenderer") {
            if let Some(track) = parse_track_from_list_item(renderer) {
                tracks.push(track);
            }
        }
    }
    tracks
}

fn parse_library_albums(data: &Value) -> Vec<AlbumSummary> {
    let items = find_browse_list_items(data);
    let mut albums = Vec::new();
    for item in items {
        // Try musicTwoRowItemRenderer (grid items)
        if let Some(two_row) = item.get("musicTwoRowItemRenderer") {
            if let Some(album) = parse_album_from_two_row(two_row) {
                albums.push(album);
            }
        }
        // Try musicResponsiveListItemRenderer (list items)
        if let Some(renderer) = item.get("musicResponsiveListItemRenderer") {
            if let Some(album) = parse_album_from_list_item(renderer) {
                albums.push(album);
            }
        }
    }
    albums
}

fn parse_library_artists(data: &Value) -> Vec<ArtistSummary> {
    let items = find_browse_list_items(data);
    let mut artists = Vec::new();
    for item in items {
        // Try musicTwoRowItemRenderer (grid items)
        if let Some(two_row) = item.get("musicTwoRowItemRenderer") {
            if let Some(artist) = parse_artist_from_two_row(two_row) {
                artists.push(artist);
            }
        }
        // Try musicResponsiveListItemRenderer (list items)
        if let Some(renderer) = item.get("musicResponsiveListItemRenderer") {
            if let Some(artist) = parse_artist_from_list_item(renderer) {
                artists.push(artist);
            }
        }
    }
    artists
}

fn parse_playlist_detail(data: &Value, playlist_id: &str) -> PlaylistDetail {
    let two_col = &data["contents"]["twoColumnBrowseResultsRenderer"];
    let single_col = &data["contents"]["singleColumnBrowseResultsRenderer"];

    // --- Header: try twoColumn (musicResponsiveHeaderRenderer), then legacy paths ---
    // User-created playlists wrap the responsive header in
    // musicEditablePlaylistDetailHeaderRenderer (either at data.header.* or
    // inside the sectionListRenderer contents).
    let responsive_header = two_col["tabs"]
        .get(0)
        .and_then(|t| t["tabRenderer"]["content"]["sectionListRenderer"]["contents"].as_array())
        .and_then(|sections| {
            sections.iter().find_map(|s| {
                // Direct responsive header
                if let Some(h) = s.get("musicResponsiveHeaderRenderer") {
                    return Some(h);
                }
                // Wrapped in editable playlist header (user-created playlists)
                let inner = &s["musicEditablePlaylistDetailHeaderRenderer"]["header"];
                if let Some(h) = inner.get("musicResponsiveHeaderRenderer") {
                    return Some(h);
                }
                None
            })
        });

    // Fallback: top-level data.header.musicEditablePlaylistDetailHeaderRenderer
    let editable_inner = &data["header"]["musicEditablePlaylistDetailHeaderRenderer"]["header"];

    let title = responsive_header
        .and_then(|h| h["title"]["runs"].get(0))
        .and_then(|r| r["text"].as_str())
        .or_else(|| {
            data["header"]["musicImmersiveHeaderRenderer"]["title"]["runs"]
                .get(0).and_then(|r| r["text"].as_str())
        })
        .or_else(|| {
            data["header"]["musicDetailHeaderRenderer"]["title"]["runs"]
                .get(0).and_then(|r| r["text"].as_str())
        })
        .or_else(|| {
            editable_inner["musicDetailHeaderRenderer"]["title"]["runs"]
                .get(0).and_then(|r| r["text"].as_str())
        })
        .unwrap_or_default()
        .to_string();

    let description = responsive_header
        .and_then(|h| h["description"]["musicDescriptionShelfRenderer"]["description"]["runs"].get(0))
        .and_then(|r| r["text"].as_str())
        .or_else(|| {
            data["header"]["musicImmersiveHeaderRenderer"]["description"]["runs"]
                .get(0).and_then(|r| r["text"].as_str())
        })
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    let artwork_url = responsive_header
        .map(|h| best_thumbnail(&h["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"]))
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let url = best_thumbnail(
                &data["header"]["musicImmersiveHeaderRenderer"]["thumbnail"]
                    ["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
            );
            if url.is_empty() { None } else { Some(url) }
        })
        .or_else(|| {
            // User-created playlists: musicEditablePlaylistDetailHeaderRenderer →
            //   musicDetailHeaderRenderer → thumbnail.croppedSquareThumbnailRenderer OR musicThumbnailRenderer
            let detail = &editable_inner["musicDetailHeaderRenderer"]["thumbnail"];
            let cropped = best_thumbnail(
                &detail["croppedSquareThumbnailRenderer"]["thumbnail"]["thumbnails"],
            );
            if !cropped.is_empty() {
                return Some(cropped);
            }
            let music = best_thumbnail(
                &detail["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
            );
            if music.is_empty() { None } else { Some(music) }
        })
        .or_else(|| {
            // Direct musicDetailHeaderRenderer at top level (some legacy responses)
            let detail = &data["header"]["musicDetailHeaderRenderer"]["thumbnail"];
            let cropped = best_thumbnail(
                &detail["croppedSquareThumbnailRenderer"]["thumbnail"]["thumbnails"],
            );
            if !cropped.is_empty() {
                return Some(cropped);
            }
            let music = best_thumbnail(
                &detail["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
            );
            if music.is_empty() { None } else { Some(music) }
        })
        .unwrap_or_default();

    // --- Tracks: search ALL sections for shelf renderers containing tracks ---
    // Albums use musicShelfRenderer, playlists use musicPlaylistShelfRenderer
    let mut tracks = Vec::new();

    fn collect_tracks_from_sections(sections: &[Value], out: &mut Vec<TrackInfo>) {
        for section in sections {
            for key in ["musicPlaylistShelfRenderer", "musicShelfRenderer"] {
                if let Some(items) = section[key]["contents"].as_array() {
                    for item in items {
                        if let Some(renderer) = item.get("musicResponsiveListItemRenderer") {
                            if let Some(track) = parse_track_from_list_item(renderer) {
                                out.push(track);
                            }
                        }
                        // Show / podcast pages (browseId MPSP*) emit
                        // episodes as multi-row list items rather than
                        // the single-row renderer used by song-bearing
                        // playlists. Drain the same shelf for either
                        // shape so the same get_playlist IPC handles
                        // both surfaces — frontend doesn't need a
                        // separate `get_show` endpoint.
                        if let Some(renderer) = item.get("musicMultiRowListItemRenderer") {
                            if let Some(track) = parse_episode_from_multi_row(renderer) {
                                out.push(track);
                            }
                        }
                    }
                }
            }
        }
    }

    // twoColumnBrowseResultsRenderer.secondaryContents.sectionListRenderer.contents[*]
    if let Some(sections) = two_col["secondaryContents"]["sectionListRenderer"]["contents"].as_array() {
        collect_tracks_from_sections(sections, &mut tracks);
    }

    // singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[*]
    if tracks.is_empty() {
        if let Some(sections) = single_col["tabs"].get(0)
            .and_then(|t| t["tabRenderer"]["content"]["sectionListRenderer"]["contents"].as_array())
        {
            collect_tracks_from_sections(sections, &mut tracks);
        }
    }

    tracing::info!(playlist_id, track_count = tracks.len(), "parsed playlist detail");

    let track_count = if tracks.is_empty() {
        None
    } else {
        Some(tracks.len() as u32)
    };

    // --- Library toggle state + audio playlist ID (issues #54, #55) ---
    let library_toggle = extract_library_save_toggle(data);
    let is_in_library = library_toggle.as_ref().map(|t| t.is_toggled).unwrap_or(false);
    // Prefer the toggle's own target — it's the canonical ID YTM's own save
    // button posts to /like/like with. Fall back to a watch-endpoint scan
    // for any older response shapes.
    let audio_playlist_id = library_toggle
        .and_then(|t| t.target_playlist_id)
        .or_else(|| extract_audio_playlist_id(data));
    let is_album = playlist_id.starts_with("MPRE");

    PlaylistDetail {
        playlist_id: playlist_id.to_string(),
        title,
        description,
        artwork_url,
        track_count,
        tracks,
        is_in_library,
        audio_playlist_id,
        is_album,
    }
}

struct LibrarySaveToggle {
    is_toggled: bool,
    target_playlist_id: Option<String>,
}

/// Find the header's "Save to library" toggle button and read both its
/// `isToggled` flag and the playlistId it posts to (issues #54, #55).
///
/// In current YTM responses this is a `toggleButtonRenderer` whose
/// `defaultServiceEndpoint.likeEndpoint` carries `target.playlistId`. The
/// icon pair is `BOOKMARK_BORDER` ↔ `BOOKMARK`. Older responses sometimes
/// used `LIBRARY_ADD` ↔ `LIBRARY_SAVED`, so we accept either signal.
fn extract_library_save_toggle(data: &Value) -> Option<LibrarySaveToggle> {
    fn walk(val: &Value, depth: u8) -> Option<LibrarySaveToggle> {
        if depth > 14 {
            return None;
        }
        if let Some(toggle) = val.get("toggleButtonRenderer") {
            let default_icon =
                toggle["defaultIcon"]["iconType"].as_str().unwrap_or("");
            let toggled_icon =
                toggle["toggledIcon"]["iconType"].as_str().unwrap_or("");
            let has_like_endpoint =
                toggle["defaultServiceEndpoint"].get("likeEndpoint").is_some()
                    || toggle["toggledServiceEndpoint"]
                        .get("likeEndpoint")
                        .is_some();
            let icon_matches = default_icon == "BOOKMARK_BORDER"
                || default_icon == "BOOKMARK"
                || toggled_icon == "BOOKMARK"
                || default_icon.contains("LIBRARY")
                || toggled_icon.contains("LIBRARY");
            if has_like_endpoint || icon_matches {
                if let Some(is_toggled) = toggle["isToggled"].as_bool() {
                    let target_playlist_id = toggle["defaultServiceEndpoint"]
                        ["likeEndpoint"]["target"]["playlistId"]
                        .as_str()
                        .or_else(|| {
                            toggle["toggledServiceEndpoint"]["likeEndpoint"]
                                ["target"]["playlistId"]
                                .as_str()
                        })
                        .map(|s| s.to_string());
                    return Some(LibrarySaveToggle {
                        is_toggled,
                        target_playlist_id,
                    });
                }
            }
        }
        match val {
            Value::Object(map) => {
                for v in map.values() {
                    if let Some(found) = walk(v, depth + 1) {
                        return Some(found);
                    }
                }
            }
            Value::Array(arr) => {
                for v in arr {
                    if let Some(found) = walk(v, depth + 1) {
                        return Some(found);
                    }
                }
            }
            _ => {}
        }
        None
    }
    walk(data, 0)
}

/// Fallback: pull a playable playlist ID (OLAK*, RDCLAK*, PL*) from any
/// watch endpoint in the response, used only when no toggle button surfaces
/// one (issue #54).
fn extract_audio_playlist_id(data: &Value) -> Option<String> {
    fn walk(val: &Value, depth: u8) -> Option<String> {
        if depth > 12 {
            return None;
        }
        for key in ["watchEndpoint", "watchPlaylistEndpoint"] {
            if let Some(ep) = val.get(key) {
                if let Some(id) = ep["playlistId"].as_str() {
                    if id.starts_with("OLAK") || id.starts_with("RDCLAK") || id.starts_with("PL") {
                        return Some(id.to_string());
                    }
                }
            }
        }
        match val {
            Value::Object(map) => {
                for v in map.values() {
                    if let Some(found) = walk(v, depth + 1) {
                        return Some(found);
                    }
                }
            }
            Value::Array(arr) => {
                for v in arr {
                    if let Some(found) = walk(v, depth + 1) {
                        return Some(found);
                    }
                }
            }
            _ => {}
        }
        None
    }
    walk(data, 0)
}

fn parse_explore_shelves(data: &Value) -> Vec<Shelf> {
    let mut shelves = Vec::new();

    // Explore response has the same top-level structure as home
    let sections = data["contents"]["singleColumnBrowseResultsRenderer"]["tabs"]
        .get(0)
        .and_then(|t| t["tabRenderer"]["content"]["sectionListRenderer"]["contents"].as_array());

    let Some(sections) = sections else {
        return shelves;
    };

    for section in sections {
        if let Some(carousel) = section.get("musicCarouselShelfRenderer") {
            let title = extract_header_title(carousel);
            if title.is_empty() {
                continue;
            }

            let items = carousel["contents"].as_array();
            let Some(items) = items else { continue };

            let mut song_items = Vec::new();
            let mut album_items = Vec::new();
            let mut playlist_items = Vec::new();
            let mut artist_items = Vec::new();

            for item in items {
                if let Some(two_row) = item.get("musicTwoRowItemRenderer") {
                    dispatch_two_row_item(
                        two_row,
                        &mut song_items,
                        &mut album_items,
                        &mut playlist_items,
                        &mut artist_items,
                    );
                }

                // musicResponsiveListItemRenderer — songs
                if let Some(list_item) = item.get("musicResponsiveListItemRenderer") {
                    if let Some(track) = parse_track_from_list_item(list_item) {
                        song_items.push(track);
                    }
                }
            }

            let content = if !song_items.is_empty() {
                ShelfContent::Songs(song_items)
            } else if !album_items.is_empty() {
                ShelfContent::Albums(album_items)
            } else if !playlist_items.is_empty() {
                ShelfContent::Playlists(playlist_items)
            } else if !artist_items.is_empty() {
                ShelfContent::Artists(artist_items)
            } else {
                continue;
            };

            shelves.push(Shelf { title, items: content });
        }
        // Skip gridRenderer (tab chips) and musicNavigationButtonRenderer (moods labels)
    }

    shelves
}

/// Parse an album from a `musicResponsiveListItemRenderer` in filtered search results.
fn parse_album_from_list_item(renderer: &Value) -> Option<AlbumSummary> {
    let flex_columns = renderer["flexColumns"].as_array()?;

    let title = flex_columns
        .first()
        .map(|col| {
            runs_text(&col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"])
        })
        .unwrap_or_default();

    if title.is_empty() {
        return None;
    }

    let secondary_text = flex_columns.get(1).map(|col| {
        runs_text(&col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"])
    });

    let artist = secondary_text
        .as_deref()
        .map(|s| {
            // Secondary text: "Album • Artist • Year" or "Single • Artist • Year"
            let parts: Vec<&str> = s.split(" \u{2022} ").collect();
            parts.get(1).unwrap_or(&"").trim().to_string()
        })
        .unwrap_or_default();

    let year = secondary_text
        .as_deref()
        .and_then(|s| {
            let parts: Vec<&str> = s.split(" \u{2022} ").collect();
            parts.last().and_then(|y| {
                let y = y.trim();
                if y.len() == 4 && y.chars().all(|c| c.is_ascii_digit()) {
                    Some(y.to_string())
                } else {
                    None
                }
            })
        });

    // browseId from the first flex column run's navigation, or from the renderer itself
    let browse_id = flex_columns
        .first()
        .and_then(|col| {
            col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
                .get(0)
                .and_then(|r| r["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str())
        })
        .or_else(|| {
            renderer["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str()
        })
        .unwrap_or_default()
        .to_string();

    let artwork_url = best_thumbnail(
        &renderer["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    );

    Some(AlbumSummary {
        browse_id,
        title,
        artist,
        artwork_url,
        year,
    })
}

/// Parse an artist from a `musicResponsiveListItemRenderer` in filtered search results.
fn parse_artist_from_list_item(renderer: &Value) -> Option<ArtistSummary> {
    let flex_columns = renderer["flexColumns"].as_array()?;

    let name = flex_columns
        .first()
        .map(|col| {
            runs_text(&col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"])
        })
        .unwrap_or_default();

    if name.is_empty() {
        return None;
    }

    let subscriber_count = flex_columns.get(1).map(|col| {
        runs_text(&col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"])
    }).filter(|s| !s.is_empty());

    // channelId from the first flex column run's navigation, or from the renderer itself
    let channel_id = flex_columns
        .first()
        .and_then(|col| {
            col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
                .get(0)
                .and_then(|r| r["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str())
        })
        .or_else(|| {
            renderer["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str()
        })
        .unwrap_or_default()
        .to_string();

    let avatar_url = best_thumbnail(
        &renderer["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    );

    Some(ArtistSummary {
        channel_id,
        name,
        avatar_url,
        subscriber_count,
    })
}

/// Parse a playlist from a `musicResponsiveListItemRenderer` in filtered search results.
fn parse_playlist_from_list_item(renderer: &Value) -> Option<PlaylistSummary> {
    let flex_columns = renderer["flexColumns"].as_array()?;

    let title = flex_columns
        .first()
        .map(|col| runs_text(&col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]))
        .unwrap_or_default();

    if title.is_empty() {
        return None;
    }

    // browseId carries a VL-prefixed playlist ID in the renderer-level
    // navigationEndpoint; the overlay play button exposes the raw playlistId.
    let raw_browse = renderer["navigationEndpoint"]["browseEndpoint"]["browseId"]
        .as_str()
        .unwrap_or_default();
    let overlay_playlist = renderer["overlay"]["musicItemThumbnailOverlayRenderer"]["content"]
        ["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchPlaylistEndpoint"]["playlistId"]
        .as_str()
        .unwrap_or_default();

    let playlist_id = if !overlay_playlist.is_empty() {
        overlay_playlist.to_string()
    } else if let Some(stripped) = raw_browse.strip_prefix("VL") {
        stripped.to_string()
    } else if !raw_browse.is_empty() {
        raw_browse.to_string()
    } else {
        return None;
    };

    // Track count — secondary column often reads "Playlist • Author • N songs".
    let subtitle = flex_columns
        .get(1)
        .map(|col| runs_text(&col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]))
        .unwrap_or_default();
    let track_count = subtitle.split(" \u{2022} ").find_map(|part| {
        part.trim()
            .split_whitespace()
            .next()
            .and_then(|n| n.parse::<u32>().ok())
    });

    let artwork_url = best_thumbnail(
        &renderer["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    );

    Some(PlaylistSummary {
        playlist_id,
        title,
        artwork_url,
        track_count,
    })
}

// ---------------------------------------------------------------------------
// Shared extraction helpers
// ---------------------------------------------------------------------------

/// Extract the shelf/section title from a carousel header.
fn extract_header_title(carousel: &Value) -> String {
    // header.musicCarouselShelfBasicHeaderRenderer.title.runs[0].text
    carousel["header"]["musicCarouselShelfBasicHeaderRenderer"]["title"]["runs"]
        .get(0)
        .and_then(|r| r["text"].as_str())
        .unwrap_or_default()
        .to_string()
}

/// Extract text from a `runs` array by joining all run texts.
fn runs_text(runs: &Value) -> String {
    runs.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|r| r["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

/// Extract the best thumbnail URL from a thumbnails array.
fn best_thumbnail(thumbnails: &Value) -> String {
    thumbnails
        .as_array()
        .and_then(|arr| arr.last())
        .and_then(|t| t["url"].as_str())
        .unwrap_or_default()
        .to_string()
}

/// Extract videoId from a renderer by trying all known YTM API paths.
///
/// The YTM API nests videoId in different locations depending on context
/// (search results, home page, playlists, etc.). This function tries every
/// known path before falling back to a recursive search.
fn extract_video_id(renderer: &Value) -> String {
    // 1. playlistItemData.videoId
    if let Some(v) = renderer["playlistItemData"]["videoId"].as_str() {
        if !v.is_empty() {
            return v.to_string();
        }
    }

    // 2. overlay path (play button)
    if let Some(v) = renderer["overlay"]["musicItemThumbnailOverlayRenderer"]["content"]
        ["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchEndpoint"]["videoId"]
        .as_str()
    {
        if !v.is_empty() {
            return v.to_string();
        }
    }

    // 3. First flex column run's navigation endpoint
    if let Some(cols) = renderer["flexColumns"].as_array() {
        if let Some(col) = cols.first() {
            if let Some(runs) = col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
                .as_array()
            {
                for run in runs {
                    if let Some(v) =
                        run["navigationEndpoint"]["watchEndpoint"]["videoId"].as_str()
                    {
                        if !v.is_empty() {
                            return v.to_string();
                        }
                    }
                }
            }
        }
    }

    // 4. Direct navigationEndpoint on the renderer
    if let Some(v) = renderer["navigationEndpoint"]["watchEndpoint"]["videoId"].as_str() {
        if !v.is_empty() {
            return v.to_string();
        }
    }

    // 5. doubleTapCommand
    if let Some(v) = renderer["doubleTapCommand"]["watchEndpoint"]["videoId"].as_str() {
        if !v.is_empty() {
            return v.to_string();
        }
    }

    // 6. Recursive search through the entire renderer for any "videoId" key
    fn find_video_id_recursive(val: &Value, depth: u8) -> Option<String> {
        if depth > 5 {
            return None;
        }
        match val {
            Value::Object(map) => {
                if let Some(vid) = map.get("videoId").and_then(|v| v.as_str()) {
                    if !vid.is_empty() && vid.len() == 11 {
                        return Some(vid.to_string());
                    }
                }
                for v in map.values() {
                    if let Some(found) = find_video_id_recursive(v, depth + 1) {
                        return Some(found);
                    }
                }
                None
            }
            Value::Array(arr) => {
                for v in arr {
                    if let Some(found) = find_video_id_recursive(v, depth + 1) {
                        return Some(found);
                    }
                }
                None
            }
            _ => None,
        }
    }

    if let Some(v) = find_video_id_recursive(renderer, 0) {
        return v;
    }

    String::new()
}

/// Parse a song/video from a `musicResponsiveListItemRenderer`.
fn parse_track_from_list_item(renderer: &Value) -> Option<TrackInfo> {
    let video_id = extract_video_id(renderer);

    // flexColumns hold title, artist, album info
    let flex_columns = renderer["flexColumns"].as_array()?;

    let title = flex_columns
        .first()
        .map(|col| {
            runs_text(
                &col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"],
            )
        })
        .unwrap_or_default();

    if title.is_empty() {
        return None;
    }

    // Second column typically has: artist • album • duration
    let secondary_text = flex_columns.get(1).map(|col| {
        runs_text(&col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"])
    });

    let (artist, album) = secondary_text
        .as_deref()
        .map(|s| {
            let parts: Vec<&str> = s.split(" \u{2022} ").collect(); // split on " • "
            let a = parts.first().unwrap_or(&"").to_string();
            let b = parts.get(1).unwrap_or(&"").to_string();
            (a, b)
        })
        .unwrap_or_default();

    let artwork_url = renderer["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"]
        .as_array()
        .and_then(|arr| arr.last())
        .and_then(|t| t["url"].as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            // Fallback: use YouTube thumbnail service with the videoId
            if !video_id.is_empty() {
                Some(format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id))
            } else {
                None
            }
        });

    // Duration: prefer fixedColumns (playlist/album views put it here), then
    // fall back to flex column 2 (search results). An empty string from either
    // source is treated as missing so we keep looking.
    let fixed_duration = renderer["fixedColumns"]
        .as_array()
        .and_then(|cols| cols.first())
        .map(|col| {
            runs_text(&col["musicResponsiveListItemFixedColumnRenderer"]["text"]["runs"])
        })
        .filter(|s| !s.is_empty());

    let flex_duration = flex_columns.get(2).map(|col| {
        runs_text(&col["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"])
    }).filter(|s| !s.is_empty());

    let duration_text = fixed_duration.or(flex_duration).unwrap_or_default();

    let duration_secs = parse_duration_text(&duration_text);

    // Skip items without a videoId — they're artists/albums, not playable songs
    if video_id.is_empty() {
        tracing::debug!(title = %title, "skipping non-song item (no videoId)");
        return None;
    }

    tracing::debug!(video_id = %video_id, title = %title, "parsed track");

    Some(TrackInfo {
        video_id,
        title,
        artist,
        artist_id: None,
        album,
        album_id: None,
        artwork_url,
        duration_secs,
    })
}

/// Parse a podcast / show episode from a `musicMultiRowListItemRenderer`.
///
/// Show pages (browseId `MPSP*`) emit episodes as multi-row list items
/// instead of the single-row `musicResponsiveListItemRenderer` used by
/// songs. Shape (verified against YTM browse responses):
///
/// ```text
/// musicMultiRowListItemRenderer:
///   title:             { runs: [{ text: "<episode title>" }] }
///   subtitle:          { runs: [{ text: "<show name>" | "<date>" | …}] }
///   description:       { runs: [{ text: "<short summary>" }] }   (optional)
///   thumbnail:
///     musicThumbnailRenderer:
///       thumbnail: { thumbnails: [...] }
///   onTap:
///     watchEndpoint: { videoId: "<episode video id>" }
///   menu / overlay holds duration text in some shapes
/// ```
///
/// Produces a `TrackInfo` so the existing `playerApi.playTrack` chain
/// can play the episode without any additional plumbing — the show
/// name lands in `artist`, episode title in `title`, episode video id
/// in `video_id`. Duration parsing is best-effort; missing → 0.
fn parse_episode_from_multi_row(renderer: &Value) -> Option<TrackInfo> {
    let title = runs_text(&renderer["title"]["runs"]);
    if title.is_empty() {
        return None;
    }

    // The show name lands in subtitle.runs. YTM sometimes prepends a
    // publish-date run separated by " • " — keep the trailing run as
    // the show name when that pattern is detected.
    let subtitle = runs_text(&renderer["subtitle"]["runs"]);
    let show_name = if subtitle.contains(" \u{2022} ") {
        subtitle
            .rsplit(" \u{2022} ")
            .next()
            .unwrap_or("")
            .to_string()
    } else {
        subtitle.clone()
    };

    // VideoId — try the renderer's direct watchEndpoint first, then
    // the `onTap` wrapper YTM uses on some shows, then the
    // play-button overlay fallback used by `extract_video_id`.
    let video_id = renderer["onTap"]["watchEndpoint"]["videoId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| extract_video_id(renderer));

    if video_id.is_empty() {
        // Episode without a playable id (e.g. "available soon"
        // placeholder) — skip rather than emit a row that no-ops on
        // click.
        return None;
    }

    let artwork_url = best_thumbnail(
        &renderer["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    );
    let artwork_url = if artwork_url.is_empty() {
        None
    } else {
        Some(artwork_url)
    };

    // Duration: shows surface it inconsistently. Try the menu's
    // playlistAddToOptionsRenderer text, then any `playbackProgress`
    // blob's total time. Fall through to 0 (treated as unknown by the
    // frontend duration display).
    let duration_text = renderer["playbackProgress"]
        ["musicPlaybackProgressRenderer"]["durationText"]["runs"]
        .as_array()
        .map(|runs| runs.iter().filter_map(|r| r["text"].as_str()).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();
    let duration_secs = parse_duration_text(&duration_text);

    Some(TrackInfo {
        video_id,
        title,
        artist: show_name,
        artist_id: None,
        album: String::new(),
        album_id: None,
        artwork_url,
        duration_secs,
    })
}

/// Parse a duration string like "3:45" or "1:02:30" into seconds.
fn parse_duration_text(text: &str) -> f64 {
    let parts: Vec<&str> = text.trim().split(':').collect();
    match parts.len() {
        2 => {
            let mins: f64 = parts[0].parse().unwrap_or(0.0);
            let secs: f64 = parts[1].parse().unwrap_or(0.0);
            mins * 60.0 + secs
        }
        3 => {
            let hours: f64 = parts[0].parse().unwrap_or(0.0);
            let mins: f64 = parts[1].parse().unwrap_or(0.0);
            let secs: f64 = parts[2].parse().unwrap_or(0.0);
            hours * 3600.0 + mins * 60.0 + secs
        }
        _ => 0.0,
    }
}

/// Parse a single video track from a `musicTwoRowItemRenderer`.
/// Used for cards that represent a single song/video rather than a collection.
fn parse_track_from_two_row(two_row: &Value) -> Option<TrackInfo> {
    // Video ID from navigationEndpoint.watchEndpoint.videoId
    let video_id = two_row["navigationEndpoint"]["watchEndpoint"]["videoId"]
        .as_str()
        .or_else(|| {
            two_row["thumbnailOverlay"]["musicItemThumbnailOverlayRenderer"]["content"]
                ["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchEndpoint"]["videoId"]
                .as_str()
        })
        .unwrap_or_default();

    if video_id.is_empty() {
        return None;
    }

    let title = runs_text(&two_row["title"]["runs"]);
    if title.is_empty() {
        return None;
    }

    let artist = runs_text(&two_row["subtitle"]["runs"]);

    let artwork_url = best_thumbnail(
        &two_row["thumbnailRenderer"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    );
    let artwork_url = if artwork_url.is_empty() {
        Some(format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id))
    } else {
        Some(artwork_url)
    };

    Some(TrackInfo {
        video_id: video_id.to_string(),
        title,
        artist,
        artist_id: None,
        album: String::new(),
        album_id: None,
        artwork_url,
        duration_secs: 0.0,
    })
}

/// Extract playlist ID from a `musicTwoRowItemRenderer`, checking both navigation and overlay paths.
fn extract_playlist_id_from_two_row(two_row: &Value) -> String {
    // 1. Standard browseEndpoint browseId (usually "VL" + playlist_id for playlists)
    if let Some(bid) = two_row["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str() {
        if !bid.is_empty() {
            return bid.to_string();
        }
    }
    // 2. Overlay play button's watchPlaylistEndpoint.playlistId (common for home page playlists)
    if let Some(pid) = two_row["thumbnailOverlay"]["musicItemThumbnailOverlayRenderer"]["content"]
        ["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchPlaylistEndpoint"]["playlistId"]
        .as_str()
    {
        if !pid.is_empty() {
            return pid.to_string();
        }
    }
    // 3. Overlay play button's watchEndpoint.playlistId
    if let Some(pid) = two_row["thumbnailOverlay"]["musicItemThumbnailOverlayRenderer"]["content"]
        ["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchEndpoint"]["playlistId"]
        .as_str()
    {
        if !pid.is_empty() {
            return pid.to_string();
        }
    }
    String::new()
}

/// Parse an album from a `musicTwoRowItemRenderer`.
fn parse_album_from_two_row(two_row: &Value) -> Option<AlbumSummary> {
    let title = runs_text(&two_row["title"]["runs"]);
    if title.is_empty() {
        return None;
    }

    let browse_id = two_row["navigationEndpoint"]["browseEndpoint"]["browseId"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    // An album requires a browseId — otherwise it's not a real album card.
    if browse_id.is_empty() {
        return None;
    }

    let subtitle = runs_text(&two_row["subtitle"]["runs"]);
    // Subtitle is typically "Album • Artist • Year" or "Single • Artist • Year"
    let parts: Vec<&str> = subtitle.split(" \u{2022} ").collect();
    let artist = parts.get(1).unwrap_or(&"").trim().to_string();
    let year = parts.last().and_then(|y| {
        let y = y.trim();
        if y.len() == 4 && y.chars().all(|c| c.is_ascii_digit()) {
            Some(y.to_string())
        } else {
            None
        }
    });

    let artwork_url = best_thumbnail(
        &two_row["thumbnailRenderer"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    );

    Some(AlbumSummary {
        browse_id,
        title,
        artist,
        artwork_url,
        year,
    })
}

/// Parse an artist from a `musicTwoRowItemRenderer`.
fn parse_artist_from_two_row(two_row: &Value) -> Option<ArtistSummary> {
    let name = runs_text(&two_row["title"]["runs"]);
    if name.is_empty() {
        return None;
    }

    let channel_id = two_row["navigationEndpoint"]["browseEndpoint"]["browseId"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    let subscriber_count = {
        let sub = runs_text(&two_row["subtitle"]["runs"]);
        if sub.is_empty() { None } else { Some(sub) }
    };

    let avatar_url = best_thumbnail(
        &two_row["thumbnailRenderer"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    );

    Some(ArtistSummary {
        channel_id,
        name,
        avatar_url,
        subscriber_count,
    })
}

/// Parse a playlist from a `musicTwoRowItemRenderer`.
fn parse_playlist_from_two_row(two_row: &Value) -> Option<PlaylistSummary> {
    let title = runs_text(&two_row["title"]["runs"]);
    if title.is_empty() {
        return None;
    }

    let raw = extract_playlist_id_from_two_row(two_row);
    if raw.is_empty() {
        return None;
    }
    // Strip leading "VL" prefix to get the raw playlist ID
    let playlist_id = raw.strip_prefix("VL").unwrap_or(&raw).to_string();

    let subtitle = runs_text(&two_row["subtitle"]["runs"]);
    // Try to extract track count from subtitle like "50 songs" or "Playlist • 50 songs"
    let track_count = subtitle
        .split(" \u{2022} ")
        .find_map(|part| {
            let part = part.trim();
            part.split_whitespace()
                .next()
                .and_then(|n| n.parse::<u32>().ok())
        });

    let artwork_url = best_thumbnail(
        &two_row["thumbnailRenderer"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    );

    Some(PlaylistSummary {
        playlist_id,
        title,
        artwork_url,
        track_count,
    })
}

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------

/// Walk the watch-next tab list and return the `browseId` whose tab title
/// mentions lyrics. Title matching is case-insensitive so non-English locales
/// don't silently drop to `None` — YTM localizes the tab label but keeps the
/// lyrics browse IDs identifiable on the lyrics-tab position (second tab).
/// Test whether a thumbnail URL is YTM album art
/// (`lh*.googleusercontent.com`) versus a YouTube video frame
/// (`i.ytimg.com/vi/...`). Used to identify the AUDIO renderer in a
/// counterpart pair regardless of which side `primaryRenderer`
/// happens to be on.
fn is_album_art_url(url: &str) -> bool {
    if let Some(rest) = url.strip_prefix("https://lh") {
        // Match lh3., lh4., lh5., ... googleusercontent.com prefix.
        if let Some(dot) = rest.find('.') {
            let digits = &rest[..dot];
            if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
                return rest[dot..].starts_with(".googleusercontent.com/");
            }
        }
    }
    false
}

/// Pull the largest thumbnail URL from a `playlistPanelVideoRenderer`
/// (or any renderer with the same `thumbnail.thumbnails[]` shape).
fn renderer_thumbnail(renderer: &Value) -> Option<String> {
    renderer
        .pointer("/thumbnail/thumbnails")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// Pull just the ARTIST segment from a renderer's byline. YTM
/// represents `"Artist • Album • Year"` as separate runs — the
/// artist text, then a literal " • " run, then the album text,
/// etc. Concatenating all runs (the old behavior) shipped the full
/// "Artist • Album • Year" string to LRCLIB, which never matches.
/// Walk the runs and return the first non-separator one.
/// True if a track title looks like a non-vocal recording where
/// matching against LRCLIB/NetEase would paste the vocal version's
/// lyrics onto an instrumental — the false-positive we used to
/// defend against by trusting YTM's "no lyrics" verdict.
fn looks_like_instrumental(title: &str) -> bool {
    let lower = title.to_lowercase();
    const INSTRUMENTAL_MARKERS: &[&str] = &[
        "instrumental",
        "karaoke",
        "piano cover",
        "piano version",
        "piano arrangement",
        "guitar cover",
        "violin cover",
        "string cover",
        "8-bit",
        "8 bit",
        "8bit",
        "music box",
        "lullaby version",
        "acoustic instrumental",
        "no vocal",
        "without vocal",
        "off vocal",
        "remixed by", // chiptune / remix collections often lack lyrics
    ];
    INSTRUMENTAL_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}

fn first_byline_segment(renderer: &Value) -> String {
    let runs = renderer
        .pointer("/longBylineText/runs")
        .or_else(|| renderer.pointer("/shortBylineText/runs"))
        .and_then(|v| v.as_array());
    let Some(runs) = runs else {
        return String::new();
    };
    for run in runs {
        let text = run.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        // YTM's separator is `\u{2022}` (•) sometimes flanked by
        // spaces. Skip pure-separator runs.
        if trimmed
            .chars()
            .all(|c| c == '\u{2022}' || c.is_whitespace())
        {
            continue;
        }
        return trimmed.to_string();
    }
    String::new()
}

/// In a counterpart pair, return the renderer that represents the
/// AUDIO side — the one whose thumbnail is album art on
/// `lh*.googleusercontent.com`. Returns `None` if neither side is
/// album art (both are video frames; track is fully UGC) or if the
/// wrapper has no counterpart at all.
///
/// The "primary" vs "counterpart" labels in YTM's response are
/// **playback-direction**-dependent — when the user is in audio mode
/// the audio renderer is primary and the video is counterpart; in
/// video mode, the inverse. So picking by label alone is wrong; we
/// need to identify by content.
fn pick_audio_renderer<'a>(wrapper: &'a Value) -> Option<&'a Value> {
    let primary = wrapper.pointer("/primaryRenderer/playlistPanelVideoRenderer");
    let counterpart = wrapper.pointer("/counterpart/0/counterpartRenderer/playlistPanelVideoRenderer");
    let primary_is_audio = primary
        .and_then(renderer_thumbnail)
        .map(|u| is_album_art_url(&u))
        .unwrap_or(false);
    if primary_is_audio {
        return primary;
    }
    let counterpart_is_audio = counterpart
        .and_then(renderer_thumbnail)
        .map(|u| is_album_art_url(&u))
        .unwrap_or(false);
    if counterpart_is_audio {
        return counterpart;
    }
    None
}

/// Walk a `/next` response's playlist panel and return the audio
/// renderer's videoId for the currently-playing track if YTM has
/// matched a `MUSIC_VIDEO_TYPE_OMV` (music video) to a
/// `MUSIC_VIDEO_TYPE_ATV` (audio track). Returns `None` if the
/// playing track is already the audio variant (no extra hop needed)
/// OR if YTM hasn't matched it at all (UGC). The result is suitable
/// for re-issuing /next to land on the audio variant — that's what
/// surfaces the lyrics tab YTM hides on music-video pages.
fn extract_audio_counterpart_video_id(data: &Value, current_video_id: &str) -> Option<String> {
    let contents = data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs/0/tabRenderer/content/musicQueueRenderer/content/playlistPanelRenderer/contents")?
        .as_array()?;
    for entry in contents {
        let Some(wrapper) = entry.get("playlistPanelVideoWrapperRenderer") else {
            continue;
        };
        let primary_id = wrapper
            .pointer("/primaryRenderer/playlistPanelVideoRenderer/videoId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if primary_id != current_video_id {
            continue;
        }
        let audio = pick_audio_renderer(wrapper)?;
        let audio_id = audio
            .pointer("/videoId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if audio_id.is_empty() || audio_id == current_video_id {
            // Already on the audio side; nothing to switch to.
            return None;
        }
        return Some(audio_id.to_string());
    }
    None
}

#[derive(Debug, Clone)]
struct CounterpartMeta {
    title: String,
    artist: String,
    duration_secs: f64,
}

/// Walk a `/next` response's playlist panel and return the audio
/// counterpart's clean track metadata for the currently-playing
/// track. Music-video pages tend to have noisy titles ("Stayin'
/// Alive (Official Music Video) [4K Remastered]") and "Channel" as
/// the artist, both of which corrupt LRCLIB queries. The audio
/// counterpart's title/byline are the canonical song version, served
/// from the same /next response under
/// `playlistPanelVideoWrapperRenderer.counterpart[0].counterpartRenderer`.
fn extract_audio_counterpart_meta(data: &Value, current_video_id: &str) -> Option<CounterpartMeta> {
    let contents = data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs/0/tabRenderer/content/musicQueueRenderer/content/playlistPanelRenderer/contents")?
        .as_array()?;
    for entry in contents {
        let Some(wrapper) = entry.get("playlistPanelVideoWrapperRenderer") else {
            continue;
        };
        let primary_id = wrapper
            .pointer("/primaryRenderer/playlistPanelVideoRenderer/videoId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if primary_id != current_video_id {
            continue;
        }
        // Pick the AUDIO renderer (regardless of whether it's primary
        // or counterpart) so we always read clean song metadata, never
        // the noisy music-video title / channel-name artist.
        let audio = pick_audio_renderer(wrapper)?;
        let title = audio
            .pointer("/title/runs")
            .map(runs_text)
            .unwrap_or_default();
        // YTM byline runs are "Artist • Album • Year" with each
        // segment as its own run separated by literal " • " runs.
        // For lyrics queries we want ONLY the artist — concatenating
        // everything (the old behavior) gave LRCLIB a string like
        // "Jolin Tsai • Cheng Bao (Castle) • 2004" which never
        // matches. Take the first non-separator run instead.
        let artist = first_byline_segment(audio);
        let duration_secs = audio
            .pointer("/lengthText/runs/0/text")
            .and_then(|v| v.as_str())
            .map(parse_duration_text)
            .unwrap_or(0.0);
        if title.is_empty() && artist.is_empty() && duration_secs <= 0.0 {
            return None;
        }
        return Some(CounterpartMeta { title, artist, duration_secs });
    }
    None
}

/// Walk a `/next` response's playlist panel and return the AUDIO
/// renderer's largest album-art thumbnail URL for the currently-
/// playing track — picked by scanning BOTH primary and counterpart
/// for the lh*.googleusercontent.com host (album-art CDN), since
/// YTM swaps which side is "primary" depending on the user's audio /
/// video preference. Returns `None` if neither side is album art
/// (UGC track, or no counterpart at all).
fn extract_audio_counterpart_thumbnail(data: &Value, current_video_id: &str) -> Option<String> {
    let contents = data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs/0/tabRenderer/content/musicQueueRenderer/content/playlistPanelRenderer/contents")?
        .as_array()?;
    for entry in contents {
        let Some(wrapper) = entry.get("playlistPanelVideoWrapperRenderer") else {
            continue;
        };
        let primary_id = wrapper
            .pointer("/primaryRenderer/playlistPanelVideoRenderer/videoId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if primary_id != current_video_id {
            continue;
        }
        let audio = pick_audio_renderer(wrapper)?;
        return renderer_thumbnail(audio);
    }
    None
}

fn extract_lyrics_browse_id(data: &Value) -> Option<String> {
    let tabs = data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs")?
        .as_array()?;

    for tab in tabs {
        let Some(renderer) = tab.get("tabRenderer") else { continue; };
        let title = renderer
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_lowercase();
        let Some(browse_id) = renderer
            .pointer("/endpoint/browseEndpoint/browseId")
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        if title.contains("lyric") || browse_id.starts_with("MPLYt") {
            return Some(browse_id.to_string());
        }
    }
    None
}

/// Pull the tracks that come AFTER the current track in the `next`-response
/// queue panel. YTM's playlist panel returns the full playlist in order with
/// the currently playing track marked at some internal position; `nextVideo`
/// advances from that position. Returning the whole list minus the current
/// track would put earlier album tracks at the top of the queue panel even
/// though YTM won't play them next. So slice the contents starting AFTER the
/// entry whose videoId matches the current track, and stop at `limit`.
fn extract_upcoming_tracks(data: &Value, current_video_id: &str, limit: usize) -> Vec<TrackInfo> {
    let contents = data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs/0/tabRenderer/content/musicQueueRenderer/content/playlistPanelRenderer/contents")
        .and_then(|v| v.as_array());
    let Some(contents) = contents else {
        return Vec::new();
    };

    // YTM wraps each queue entry as either:
    //   { playlistPanelVideoRenderer: { ... } }                 (older)
    //   { playlistPanelVideoWrapperRenderer:
    //       { primaryRenderer:    { playlistPanelVideoRenderer: { ... } },
    //         counterpartRenderer: [{ playlistPanelVideoRenderer: { ... } }]
    //       } } (current — counterpart present when track has both video and song)
    let renderer = |entry: &Value| -> Option<Value> {
        entry
            .get("playlistPanelVideoRenderer")
            .or_else(|| entry.pointer("/playlistPanelVideoWrapperRenderer/primaryRenderer/playlistPanelVideoRenderer"))
            .cloned()
    };
    let video_id_of = |r: &Value| -> String {
        r.get("videoId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let thumbnail_of = |r: &Value| -> Option<String> {
        r.pointer("/thumbnail/thumbnails")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|v| v.as_str())
            .map(String::from)
    };

    // Locate the current track's index in the panel. If it isn't there
    // (e.g. a pure song-radio seeded on videoId alone), fall back to
    // returning everything minus the current track — the radio panel
    // already excludes the seed from its top slot in practice.
    let current_idx = contents.iter().position(|entry| {
        renderer(entry)
            .map(|r| video_id_of(&r) == current_video_id)
            .unwrap_or(false)
    });

    let iter: Box<dyn Iterator<Item = &Value>> = match current_idx {
        Some(idx) => Box::new(contents.iter().skip(idx + 1)),
        None => Box::new(contents.iter()),
    };

    let mut out: Vec<TrackInfo> = Vec::new();
    for entry in iter {
        if out.len() >= limit {
            break;
        }
        let Some(r) = renderer(entry) else { continue };
        let video_id = video_id_of(&r);
        if video_id.is_empty() || video_id == current_video_id {
            continue;
        }
        let title = r
            .pointer("/title/runs")
            .map(runs_text)
            .unwrap_or_default();
        let artist = r
            .pointer("/longBylineText/runs")
            .or_else(|| r.pointer("/shortBylineText/runs"))
            .map(runs_text)
            .unwrap_or_default();
        let duration_secs = r
            .pointer("/lengthText/runs/0/text")
            .and_then(|v| v.as_str())
            .map(parse_duration_text)
            .unwrap_or(0.0);
        // Pick the AUDIO renderer's thumbnail regardless of whether
        // it's the primary or the counterpart. YTM swaps which side
        // is "primary" depending on the user's audio/video preference,
        // so picking by label alone is wrong: we'd sometimes return
        // the music-video frame as the "counterpart" of the playing
        // audio track. Identify the audio side by content (album-art
        // host = lh*.googleusercontent.com).
        let wrapper = entry.get("playlistPanelVideoWrapperRenderer");
        let audio_thumb = wrapper
            .and_then(pick_audio_renderer)
            .and_then(renderer_thumbnail);
        let artwork_url = audio_thumb.or_else(|| thumbnail_of(&r));

        out.push(TrackInfo {
            video_id,
            title,
            artist,
            artist_id: None,
            album: String::new(),
            album_id: None,
            artwork_url,
            duration_secs,
        });
    }
    out
}

/// Extract lyrics from a YTM `browse` response against a lyrics browseId.
///
/// YTM ships lyrics in two possible renderers depending on the track:
///   * `musicDescriptionShelfRenderer` — plain text (licensed, no timing)
///   * `elementRenderer … timedLyricsModel` — per-line synced lyrics
///     (YTM's own, available on a growing catalog)
///
/// We prefer timed lyrics when present; otherwise fall back to plain text.
fn parse_lyrics(data: &Value) -> Lyrics {
    if let Some(timed) = parse_timed_lyrics(data) {
        return timed;
    }

    let section = data
        .pointer("/contents/sectionListRenderer/contents")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first());

    let shelf = section.and_then(|s| s.get("musicDescriptionShelfRenderer"));

    let text = shelf
        .and_then(|s| s.pointer("/description/runs"))
        .map(runs_text)
        .unwrap_or_default();

    let source = shelf
        .and_then(|s| s.pointer("/footer/runs"))
        .map(runs_text)
        .filter(|s| !s.is_empty());

    Lyrics {
        text,
        source,
        lines: None,
        matched_artist: None,
        matched_title: None,
    }
}

/// Attempt to extract synced lyrics from YTM's elementRenderer-based timed
/// lyrics payload. Returns `None` when the track has no timed data — the
/// caller falls back to plain text.
fn parse_timed_lyrics(data: &Value) -> Option<Lyrics> {
    // Path shape emitted by YTM's Elements runtime for timed lyrics.
    let timed = data
        .pointer("/contents/elementRenderer/newElement/type/componentType/model/timedLyricsModel/lyricsData")
        .or_else(|| {
            // Some responses wrap the element under a sectionListRenderer list.
            data.pointer("/contents/sectionListRenderer/contents")
                .and_then(|v| v.as_array())
                .and_then(|arr| {
                    arr.iter().find_map(|entry| {
                        entry.pointer(
                            "/elementRenderer/newElement/type/componentType/model/timedLyricsModel/lyricsData",
                        )
                    })
                })
        })?;

    let entries = timed.get("timedLyricsData").and_then(|v| v.as_array())?;
    if entries.is_empty() {
        return None;
    }

    let mut lines: Vec<LyricLine> = Vec::with_capacity(entries.len());
    for entry in entries {
        let text = entry
            .get("lyricLine")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let start_ms = entry
            .pointer("/cueRange/startTimeMilliseconds")
            .and_then(parse_ms)
            .unwrap_or(0);
        let end_ms = entry
            .pointer("/cueRange/endTimeMilliseconds")
            .and_then(parse_ms);

        if text.is_empty() {
            continue;
        }
        lines.push(LyricLine {
            start_ms,
            end_ms,
            text,
        });
    }

    if lines.is_empty() {
        return None;
    }

    let text = lines
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let source = timed
        .get("sourceMessage")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty());

    Some(Lyrics {
        text,
        source,
        lines: Some(lines),
        matched_artist: None,
        matched_title: None,
    })
}

/// YTM stringifies millisecond timings; accept both numeric and string forms.
fn parse_ms(v: &Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    v.as_str().and_then(|s| s.parse::<u64>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---- clean_query_field ------------------------------------------------
    //
    // Lyrics matching feeds the cleaned title/artist into LRCLIB and
    // NetEase. A noisy YouTube title ("APT. (Official Music Video)")
    // confuses both APIs and is the primary suspect for the open
    // wrong-lyrics bug on short titles like "APT." by ROSÉ. These cases
    // pin down the strip-noise-brackets + dash-tail logic.

    #[test]
    fn clean_query_field_strips_official_mv_parens() {
        assert_eq!(clean_query_field("APT. (Official MV)"), "APT.");
        assert_eq!(clean_query_field("APT. (Official Music Video)"), "APT.");
    }

    #[test]
    fn clean_query_field_strips_full_width_brackets() {
        // YouTube's CJK upload titles often use 【…】 instead of (…).
        assert_eq!(clean_query_field("APT. 【Official MV】"), "APT.");
    }

    #[test]
    fn clean_query_field_preserves_titles_without_noise_brackets() {
        assert_eq!(clean_query_field("Love Love Love"), "Love Love Love");
        assert_eq!(
            clean_query_field("聖徒"),
            "聖徒"
        );
    }

    #[test]
    fn clean_query_field_preserves_meaningful_parens() {
        // A subtitle inside parens that isn't a noise token must survive.
        // Some songs are titled like "Reminiscent (River Flows in You)".
        let out = clean_query_field("Reminiscent (River Flows in You)");
        assert!(out.contains("Reminiscent"));
        assert!(out.contains("River Flows in You"));
    }

    #[test]
    fn clean_query_field_cuts_at_dash_tail() {
        assert_eq!(
            clean_query_field("Stayin' Alive - My Secret"),
            "Stayin' Alive"
        );
    }

    #[test]
    fn clean_query_field_keeps_short_head_when_dash_tail_would_truncate_too_much() {
        // The cut-at-dash logic only fires when the head is at least 2 chars,
        // so "A - B" should NOT collapse to "A".
        assert_eq!(clean_query_field("A - B"), "A - B");
    }

    #[test]
    fn clean_query_field_collapses_internal_whitespace() {
        // After bracket stripping you can end up with double-spaces; the
        // remote query needs them collapsed before URL-encoding.
        assert_eq!(
            clean_query_field("APT.   (Official MV)   feat. Bruno Mars"),
            "APT. feat. Bruno Mars"
        );
    }

    #[test]
    fn clean_query_field_strips_audio_and_visualizer() {
        assert_eq!(clean_query_field("Some Song [Audio]"), "Some Song");
        assert_eq!(clean_query_field("Some Song [Visualizer]"), "Some Song");
    }

    #[test]
    fn clean_query_field_handles_artist_names_with_parenthesised_alias() {
        // Artist field commonly comes in as "ROSÉ (로제)". The alias is
        // useful for NetEase but adds noise for LRCLIB; this test pins
        // the current behaviour either way so a future change is intentional.
        let out = clean_query_field("ROSÉ (로제)");
        // We don't strip non-noise parens, so the alias should survive.
        assert!(out.starts_with("ROSÉ"));
    }

    // ---- parse_duration_text ----------------------------------------------

    #[test]
    fn parse_duration_text_mm_ss() {
        assert_eq!(parse_duration_text("3:45"), 225.0);
    }

    #[test]
    fn parse_duration_text_hh_mm_ss() {
        assert_eq!(parse_duration_text("1:02:03"), 3723.0);
    }

    #[test]
    fn parse_duration_text_pads_single_digit_seconds() {
        assert_eq!(parse_duration_text("0:07"), 7.0);
    }

    #[test]
    fn parse_duration_text_handles_leading_whitespace() {
        assert_eq!(parse_duration_text("  4:20  "), 260.0);
    }

    #[test]
    fn parse_duration_text_returns_zero_for_malformed() {
        assert_eq!(parse_duration_text(""), 0.0);
        assert_eq!(parse_duration_text("abc"), 0.0);
        assert_eq!(parse_duration_text("1:2:3:4"), 0.0); // too many parts
    }

    // ---- runs_text --------------------------------------------------------

    #[test]
    fn runs_text_concatenates_text_fields() {
        let v = json!([
            { "text": "Hello" },
            { "text": ", " },
            { "text": "world" },
        ]);
        assert_eq!(runs_text(&v), "Hello, world");
    }

    #[test]
    fn runs_text_skips_missing_text() {
        let v = json!([
            { "text": "A" },
            { "notText": "B" },
            { "text": "C" },
        ]);
        assert_eq!(runs_text(&v), "AC");
    }

    #[test]
    fn runs_text_returns_empty_for_non_array() {
        assert_eq!(runs_text(&json!("not an array")), "");
        assert_eq!(runs_text(&json!(null)), "");
    }

    // ---- best_thumbnail ---------------------------------------------------

    #[test]
    fn best_thumbnail_picks_last_entry() {
        // YTM returns thumbnails smallest-first, so the last one is highest-res.
        let v = json!([
            { "url": "https://i.ytimg.com/vi/x/default.jpg", "width": 120 },
            { "url": "https://i.ytimg.com/vi/x/mqdefault.jpg", "width": 320 },
            { "url": "https://i.ytimg.com/vi/x/hqdefault.jpg", "width": 480 },
        ]);
        assert_eq!(best_thumbnail(&v), "https://i.ytimg.com/vi/x/hqdefault.jpg");
    }

    #[test]
    fn best_thumbnail_returns_empty_for_missing() {
        assert_eq!(best_thumbnail(&json!([])), "");
        assert_eq!(best_thumbnail(&json!(null)), "");
    }

    // ---- extract_video_id -------------------------------------------------

    #[test]
    fn extract_video_id_from_playlist_item_data() {
        let renderer = json!({
            "playlistItemData": { "videoId": "dQw4w9WgXcQ" }
        });
        assert_eq!(extract_video_id(&renderer), "dQw4w9WgXcQ");
    }

    #[test]
    fn extract_video_id_from_overlay_play_button() {
        let renderer = json!({
            "overlay": {
                "musicItemThumbnailOverlayRenderer": {
                    "content": {
                        "musicPlayButtonRenderer": {
                            "playNavigationEndpoint": {
                                "watchEndpoint": { "videoId": "overlay_vid" }
                            }
                        }
                    }
                }
            }
        });
        assert_eq!(extract_video_id(&renderer), "overlay_vid");
    }

    #[test]
    fn extract_video_id_from_flex_column_runs() {
        let renderer = json!({
            "flexColumns": [{
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {
                        "runs": [{
                            "text": "Song Name",
                            "navigationEndpoint": {
                                "watchEndpoint": { "videoId": "flex_vid" }
                            }
                        }]
                    }
                }
            }]
        });
        assert_eq!(extract_video_id(&renderer), "flex_vid");
    }

    #[test]
    fn extract_video_id_returns_empty_when_absent() {
        assert_eq!(extract_video_id(&json!({})), "");
    }

    #[test]
    fn extract_video_id_prefers_playlist_item_data() {
        // When multiple paths are present, the preferred source wins.
        let renderer = json!({
            "playlistItemData": { "videoId": "PRIMARY" },
            "overlay": {
                "musicItemThumbnailOverlayRenderer": {
                    "content": {
                        "musicPlayButtonRenderer": {
                            "playNavigationEndpoint": {
                                "watchEndpoint": { "videoId": "SECONDARY" }
                            }
                        }
                    }
                }
            }
        });
        assert_eq!(extract_video_id(&renderer), "PRIMARY");
    }

    // ---- parse_search_suggestions ----------------------------------------

    #[test]
    fn parse_search_suggestions_extracts_runs_text() {
        // Based on the actual YTM suggestions response shape.
        let data = json!({
            "contents": [{
                "searchSuggestionsSectionRenderer": {
                    "contents": [
                        {
                            "searchSuggestionRenderer": {
                                "suggestion": {
                                    "runs": [
                                        { "text": "rick " },
                                        { "text": "astley" }
                                    ]
                                }
                            }
                        },
                        {
                            "searchSuggestionRenderer": {
                                "suggestion": {
                                    "runs": [{ "text": "rickroll" }]
                                }
                            }
                        }
                    ]
                }
            }]
        });
        let suggestions = parse_search_suggestions(&data);
        assert_eq!(suggestions, vec!["rick astley", "rickroll"]);
    }

    #[test]
    fn parse_search_suggestions_empty_for_bad_shape() {
        assert!(parse_search_suggestions(&json!({})).is_empty());
        assert!(parse_search_suggestions(&json!(null)).is_empty());
    }

    // ---- extract_library_save_toggle -------------------------------------

    /// YTM's playlist/album header save toggle uses BOOKMARK_BORDER (default,
    /// not saved) ↔ BOOKMARK (toggled, saved) and a `likeEndpoint` carrying
    /// the canonical save target (issues #54, #55).
    #[test]
    fn extract_library_save_toggle_reads_bookmark_button() {
        let data = json!({
            "wrapper": {
                "musicResponsiveHeaderRenderer": {
                    "buttons": [
                        { "downloadButtonRenderer": {} },
                        {
                            "toggleButtonRenderer": {
                                "isToggled": true,
                                "defaultIcon": { "iconType": "BOOKMARK_BORDER" },
                                "toggledIcon": { "iconType": "BOOKMARK" },
                                "defaultServiceEndpoint": {
                                    "likeEndpoint": {
                                        "status": "LIKE",
                                        "target": { "playlistId": "OLAK5uy_test" }
                                    }
                                },
                                "toggledServiceEndpoint": {
                                    "likeEndpoint": {
                                        "status": "INDIFFERENT",
                                        "target": { "playlistId": "OLAK5uy_test" }
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        });
        let toggle = extract_library_save_toggle(&data).expect("expected toggle");
        assert!(toggle.is_toggled);
        assert_eq!(toggle.target_playlist_id.as_deref(), Some("OLAK5uy_test"));
    }

    #[test]
    fn extract_library_save_toggle_returns_false_when_not_saved() {
        let data = json!({
            "x": {
                "toggleButtonRenderer": {
                    "isToggled": false,
                    "defaultIcon": { "iconType": "BOOKMARK_BORDER" },
                    "toggledIcon": { "iconType": "BOOKMARK" },
                    "defaultServiceEndpoint": {
                        "likeEndpoint": {
                            "status": "LIKE",
                            "target": { "playlistId": "RDCLAK5uy" }
                        }
                    }
                }
            }
        });
        let toggle = extract_library_save_toggle(&data).unwrap();
        assert!(!toggle.is_toggled);
        assert_eq!(toggle.target_playlist_id.as_deref(), Some("RDCLAK5uy"));
    }

    #[test]
    fn extract_library_save_toggle_none_for_unrelated_toggle() {
        // A toggle with no like endpoint and no bookmark/library icons should
        // not be mistaken for the save button (e.g. shuffle, autoplay).
        let data = json!({
            "x": {
                "toggleButtonRenderer": {
                    "isToggled": true,
                    "defaultIcon": { "iconType": "SHUFFLE" },
                    "toggledIcon": { "iconType": "SHUFFLE" }
                }
            }
        });
        assert!(extract_library_save_toggle(&data).is_none());
    }

    // =====================================================================
    // Regression tests for features added since v0.7.0.
    // Each block is annotated with the version that introduced it.
    // =====================================================================

    // ---- v0.9.0: timed-lyrics LRC parsing --------------------------------

    #[test]
    fn parse_lrc_timestamp_accepts_mm_ss() {
        assert_eq!(parse_lrc_timestamp("01:23"), Some(83_000));
    }

    #[test]
    fn parse_lrc_timestamp_accepts_centisecond_fraction() {
        // ".42" → 420 ms
        assert_eq!(parse_lrc_timestamp("00:01.42"), Some(1_420));
    }

    #[test]
    fn parse_lrc_timestamp_accepts_millisecond_fraction() {
        // ".123" → 123 ms
        assert_eq!(parse_lrc_timestamp("00:00.123"), Some(123));
    }

    #[test]
    fn parse_lrc_timestamp_truncates_long_fraction() {
        // "1234" → first three digits (123), then ms = 123
        assert_eq!(parse_lrc_timestamp("00:00.1234"), Some(123));
    }

    #[test]
    fn parse_lrc_timestamp_pads_single_fraction_digit() {
        // ".5" → 500 ms (NOT 5 ms)
        assert_eq!(parse_lrc_timestamp("00:00.5"), Some(500));
    }

    #[test]
    fn parse_lrc_timestamp_rejects_metadata_keys() {
        assert_eq!(parse_lrc_timestamp("ar:Artist Name"), None);
        assert_eq!(parse_lrc_timestamp("ti:Song Title"), None);
    }

    #[test]
    fn parse_lrc_emits_sorted_lines_with_end_ms_filled() {
        let lrc = "[00:05.00]Hello\n[00:01.00]Earlier\n[00:10.00]Last\n";
        let lines = parse_lrc(lrc);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].start_ms, 1_000);
        assert_eq!(lines[0].end_ms, Some(5_000));
        assert_eq!(lines[0].text, "Earlier");
        assert_eq!(lines[1].start_ms, 5_000);
        assert_eq!(lines[1].end_ms, Some(10_000));
        assert_eq!(lines[1].text, "Hello");
        // Last line stays open-ended so the player extends it to track end.
        assert_eq!(lines[2].end_ms, None);
    }

    #[test]
    fn parse_lrc_handles_repeating_timestamps_per_line() {
        // LRC supports `[t1][t2]Text` — same text emitted at each timestamp.
        let lrc = "[00:00.00][00:30.00]Chorus\n";
        let lines = parse_lrc(lrc);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].start_ms, 0);
        assert_eq!(lines[1].start_ms, 30_000);
        assert_eq!(lines[0].text, "Chorus");
        assert_eq!(lines[1].text, "Chorus");
    }

    #[test]
    fn parse_lrc_skips_metadata_headers() {
        let lrc = "[ar:The Artist]\n[ti:The Title]\n[00:01.00]Lyric\n";
        let lines = parse_lrc(lrc);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Lyric");
    }

    #[test]
    fn parse_lrc_skips_blank_text_after_timestamp() {
        // Empty payload still produces a marker line — keeps timing for fades.
        let lrc = "[00:00.00]\n";
        let lines = parse_lrc(lrc);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "");
    }

    // ---- v0.9.1: extract_upcoming_tracks slicing --------------------------
    // The Playing-queue panel depends on slicing the playlist panel after
    // the currently-playing track. Bug previously: removing every entry
    // matching the current videoId returned tracks that came BEFORE the
    // cursor, so the panel disagreed with what nextVideo() would play.

    fn make_panel_entry(video_id: &str, title: &str) -> Value {
        json!({
            "playlistPanelVideoRenderer": {
                "videoId": video_id,
                "title": { "runs": [{ "text": title }] },
                "longBylineText": { "runs": [{ "text": "Artist" }] },
                "lengthText": { "runs": [{ "text": "3:30" }] },
                "thumbnail": {
                    "thumbnails": [{
                        "url": format!("https://i.ytimg.com/vi/{video_id}/hq.jpg"),
                        "width": 480, "height": 360
                    }]
                }
            }
        })
    }

    fn make_panel(video_ids: &[&str]) -> Value {
        let contents: Vec<Value> = video_ids
            .iter()
            .map(|v| make_panel_entry(v, v))
            .collect();
        json!({
            "contents": {
                "singleColumnMusicWatchNextResultsRenderer": {
                    "tabbedRenderer": {
                        "watchNextTabbedResultsRenderer": {
                            "tabs": [{
                                "tabRenderer": {
                                    "content": {
                                        "musicQueueRenderer": {
                                            "content": {
                                                "playlistPanelRenderer": {
                                                    "contents": contents
                                                }
                                            }
                                        }
                                    }
                                }
                            }]
                        }
                    }
                }
            }
        })
    }

    #[test]
    fn extract_upcoming_tracks_slices_after_current_in_playlist() {
        let data = make_panel(&["v1", "v2", "v3", "v4", "v5"]);
        let out = extract_upcoming_tracks(&data, "v2", 100);
        let ids: Vec<&str> = out.iter().map(|t| t.video_id.as_str()).collect();
        assert_eq!(ids, vec!["v3", "v4", "v5"]);
    }

    #[test]
    fn extract_upcoming_tracks_returns_empty_when_current_is_last() {
        let data = make_panel(&["v1", "v2", "v3"]);
        let out = extract_upcoming_tracks(&data, "v3", 100);
        assert!(out.is_empty());
    }

    #[test]
    fn extract_upcoming_tracks_falls_back_when_current_not_in_panel() {
        // E.g. song-radio responses where the seed isn't in the queue panel.
        // Behaviour: return everything except entries matching the current id.
        let data = make_panel(&["a", "b", "c"]);
        let out = extract_upcoming_tracks(&data, "ZZZ_NOT_PRESENT", 100);
        let ids: Vec<&str> = out.iter().map(|t| t.video_id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn extract_upcoming_tracks_respects_limit() {
        let data = make_panel(&["v1", "v2", "v3", "v4", "v5"]);
        let out = extract_upcoming_tracks(&data, "v1", 2);
        let ids: Vec<&str> = out.iter().map(|t| t.video_id.as_str()).collect();
        assert_eq!(ids, vec!["v2", "v3"]);
    }

    #[test]
    fn extract_upcoming_tracks_returns_empty_for_missing_panel() {
        let data = json!({ "contents": {} });
        assert!(extract_upcoming_tracks(&data, "v1", 100).is_empty());
    }

    #[test]
    fn extract_upcoming_tracks_supports_wrapper_renderer() {
        // YTM newer responses wrap entries in
        // playlistPanelVideoWrapperRenderer / primaryRenderer.
        let wrapped = json!({
            "playlistPanelVideoWrapperRenderer": {
                "primaryRenderer": {
                    "playlistPanelVideoRenderer": {
                        "videoId": "wrapped_vid",
                        "title": { "runs": [{ "text": "Wrapped" }] },
                        "longBylineText": { "runs": [{ "text": "Artist" }] },
                        "lengthText": { "runs": [{ "text": "3:00" }] },
                        "thumbnail": { "thumbnails": [] }
                    }
                }
            }
        });
        let data = json!({
            "contents": {
                "singleColumnMusicWatchNextResultsRenderer": {
                    "tabbedRenderer": {
                        "watchNextTabbedResultsRenderer": {
                            "tabs": [{
                                "tabRenderer": {
                                    "content": {
                                        "musicQueueRenderer": {
                                            "content": {
                                                "playlistPanelRenderer": {
                                                    "contents": [wrapped]
                                                }
                                            }
                                        }
                                    }
                                }
                            }]
                        }
                    }
                }
            }
        });
        let out = extract_upcoming_tracks(&data, "different_seed", 100);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].video_id, "wrapped_vid");
        assert_eq!(out[0].title, "Wrapped");
    }

    // ---- audio counterpart parsing ----------------------------------------
    //
    // YTM matches every official music video (`MUSIC_VIDEO_TYPE_OMV`) to
    // its audio track (`MUSIC_VIDEO_TYPE_ATV`) and exposes the audio
    // counterpart's videoId + album-art thumbnail under
    // `playlistPanelVideoWrapperRenderer.counterpartRenderer[0]
    // .playlistPanelVideoRenderer`. We use this to (a) show the song's
    // album-art cover in the queue instead of the video's 16:9 frame,
    // and (b) re-issue /next against the audio counterpart for the
    // lyrics tab YTM hides on most music-video pages.

    fn build_next_with_counterpart(
        primary_id: &str,
        primary_thumb: &str,
        counterpart_id: &str,
        counterpart_thumb: &str,
    ) -> Value {
        json!({
            "contents": { "singleColumnMusicWatchNextResultsRenderer": { "tabbedRenderer": {
                "watchNextTabbedResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                    "musicQueueRenderer": { "content": { "playlistPanelRenderer": { "contents": [
                        { "playlistPanelVideoWrapperRenderer": {
                            "primaryRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": primary_id,
                                "title": { "runs": [{ "text": "Little Lies" }] },
                                "longBylineText": { "runs": [{ "text": "Fleetwood Mac" }] },
                                "lengthText": { "runs": [{ "text": "3:42" }] },
                                "thumbnail": { "thumbnails": [
                                    { "url": primary_thumb }
                                ]}
                            }},
                            "counterpart": [{
                                "counterpartRenderer": {
                                    "playlistPanelVideoRenderer": {
                                        "videoId": counterpart_id,
                                        "title": { "runs": [{ "text": "Little Lies" }] },
                                        "longBylineText": { "runs": [{ "text": "Fleetwood Mac" }] },
                                        "thumbnail": { "thumbnails": [
                                            { "url": counterpart_thumb }
                                        ]}
                                    }
                                }
                            }]
                        }}
                    ]}}}
                }}}]}
            }}}
        })
    }

    #[test]
    fn extract_audio_counterpart_returns_audio_video_id_when_playing_video() {
        let data = build_next_with_counterpart(
            "videoVID",
            "https://i.ytimg.com/vi/videoVID/sddefault.jpg?sqp=foo",
            "audioVID",
            "https://lh3.googleusercontent.com/abc=w512-h512",
        );
        let out = extract_audio_counterpart_video_id(&data, "videoVID");
        assert_eq!(out.as_deref(), Some("audioVID"));
    }

    #[test]
    fn extract_audio_counterpart_returns_none_for_unknown_video() {
        let data = build_next_with_counterpart("vidA", "x", "audA", "y");
        assert!(extract_audio_counterpart_video_id(&data, "different_id").is_none());
    }

    #[test]
    fn extract_audio_counterpart_returns_none_when_no_wrapper() {
        // Older response shape with bare playlistPanelVideoRenderer:
        // there's nothing to switch to.
        let data = json!({
            "contents": { "singleColumnMusicWatchNextResultsRenderer": { "tabbedRenderer": {
                "watchNextTabbedResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                    "musicQueueRenderer": { "content": { "playlistPanelRenderer": { "contents": [
                        { "playlistPanelVideoRenderer": {
                            "videoId": "soloVid",
                            "title": { "runs": [{ "text": "Solo" }] },
                            "longBylineText": { "runs": [{ "text": "Artist" }] },
                            "thumbnail": { "thumbnails": [] }
                        }}
                    ]}}}
                }}}]}
            }}}
        });
        assert!(extract_audio_counterpart_video_id(&data, "soloVid").is_none());
    }

    #[test]
    fn first_byline_segment_drops_album_year_after_artist() {
        // Real shape: YTM byline runs are
        //   [{text:"Jolin Tsai"}, {text:" • "}, {text:"Cheng Bao"}, {text:" • "}, {text:"2004"}]
        let renderer = json!({
            "longBylineText": { "runs": [
                { "text": "Jolin Tsai" },
                { "text": " \u{2022} " },
                { "text": "Cheng Bao (Castle)" },
                { "text": " \u{2022} " },
                { "text": "2004" }
            ]}
        });
        assert_eq!(first_byline_segment(&renderer), "Jolin Tsai");
    }

    #[test]
    fn first_byline_segment_falls_back_to_short_byline() {
        let renderer = json!({
            "shortBylineText": { "runs": [
                { "text": "Bee Gees" },
                { "text": " \u{2022} " },
                { "text": "Album" }
            ]}
        });
        assert_eq!(first_byline_segment(&renderer), "Bee Gees");
    }

    #[test]
    fn first_byline_segment_returns_empty_when_no_runs() {
        assert_eq!(first_byline_segment(&json!({})), "");
    }

    #[test]
    fn looks_like_instrumental_catches_common_markers() {
        assert!(looks_like_instrumental("Stayin' Alive (Instrumental)"));
        assert!(looks_like_instrumental("Take On Me — Karaoke version"));
        assert!(looks_like_instrumental("Wonderwall (Piano Cover)"));
        assert!(looks_like_instrumental("Never Gonna Give You Up (8-Bit Version)"));
        assert!(looks_like_instrumental("Bohemian Rhapsody (Music Box)"));
    }

    #[test]
    fn looks_like_instrumental_rejects_normal_titles() {
        assert!(!looks_like_instrumental("Love Love Love"));
        assert!(!looks_like_instrumental("Stayin' Alive"));
        assert!(!looks_like_instrumental("人世间"));
        assert!(!looks_like_instrumental("APT."));
    }

    #[test]
    fn extract_audio_counterpart_meta_returns_clean_song_title_and_artist() {
        // Music video has a noisy "Stayin' Alive (Official Video)" title
        // and "Bee Gees - Topic" / channel name as artist; the audio
        // counterpart is the clean "Stayin' Alive" / "Bee Gees" pair
        // with a real lengthText.
        // Primary is the music video (i.ytimg.com video frame thumbnail);
        // counterpart is the audio side (lh3.googleusercontent.com album
        // art). pick_audio_renderer must identify the counterpart as
        // audio by content (album-art host), not by JSON label.
        let data = json!({
            "contents": { "singleColumnMusicWatchNextResultsRenderer": { "tabbedRenderer": {
                "watchNextTabbedResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                    "musicQueueRenderer": { "content": { "playlistPanelRenderer": { "contents": [
                        { "playlistPanelVideoWrapperRenderer": {
                            "primaryRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": "videoVID",
                                "title": { "runs": [{ "text": "Stayin' Alive (Official Music Video)" }] },
                                "longBylineText": { "runs": [{ "text": "Bee Gees - Topic" }] },
                                "lengthText": { "runs": [{ "text": "4:45" }] },
                                "thumbnail": { "thumbnails": [
                                    { "url": "https://i.ytimg.com/vi/videoVID/hq720.jpg?sqp=foo&rs=bar" }
                                ]}
                            }},
                            "counterpart": [{
                                "counterpartRenderer": {
                                    "playlistPanelVideoRenderer": {
                                        "videoId": "audioVID",
                                        "title": { "runs": [{ "text": "Stayin' Alive" }] },
                                        "longBylineText": { "runs": [{ "text": "Bee Gees" }] },
                                        "lengthText": { "runs": [{ "text": "4:09" }] },
                                        "thumbnail": { "thumbnails": [
                                            { "url": "https://lh3.googleusercontent.com/audioCover=w512-h512" }
                                        ]}
                                    }
                                }
                            }]
                        }}
                    ]}}}
                }}}]}
            }}}
        });
        let meta = extract_audio_counterpart_meta(&data, "videoVID").expect("must find meta");
        assert_eq!(meta.title, "Stayin' Alive");
        assert_eq!(meta.artist, "Bee Gees");
        // 4:09 = 249 seconds
        assert_eq!(meta.duration_secs as i64, 249);
    }

    #[test]
    fn extract_audio_counterpart_thumbnail_returns_audio_when_video_is_primary() {
        // Same fixture orientation as above: primary = video, counterpart = audio.
        let data = json!({
            "contents": { "singleColumnMusicWatchNextResultsRenderer": { "tabbedRenderer": {
                "watchNextTabbedResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                    "musicQueueRenderer": { "content": { "playlistPanelRenderer": { "contents": [
                        { "playlistPanelVideoWrapperRenderer": {
                            "primaryRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": "videoVID",
                                "thumbnail": { "thumbnails": [
                                    { "url": "https://i.ytimg.com/vi/videoVID/hq720.jpg?sqp=x&rs=y" }
                                ]}
                            }},
                            "counterpart": [{ "counterpartRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": "audioVID",
                                "thumbnail": { "thumbnails": [
                                    { "url": "https://lh3.googleusercontent.com/audioCover=w512-h512" }
                                ]}
                            }}}]
                        }}
                    ]}}}
                }}}]}
            }}}
        });
        let url = extract_audio_counterpart_thumbnail(&data, "videoVID")
            .expect("must find audio thumbnail");
        assert!(url.starts_with("https://lh3.googleusercontent.com/"), "got {url}");
    }

    #[test]
    fn extract_audio_counterpart_thumbnail_returns_audio_when_audio_is_primary() {
        // Inverse orientation: user is in audio mode, so primary = audio (lh3
        // album art) and counterpart = video. The audio renderer is the
        // primary itself; we should return the primary's lh3 thumbnail,
        // NOT the counterpart's i.ytimg video frame.
        let data = json!({
            "contents": { "singleColumnMusicWatchNextResultsRenderer": { "tabbedRenderer": {
                "watchNextTabbedResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                    "musicQueueRenderer": { "content": { "playlistPanelRenderer": { "contents": [
                        { "playlistPanelVideoWrapperRenderer": {
                            "primaryRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": "audioVID",
                                "thumbnail": { "thumbnails": [
                                    { "url": "https://lh3.googleusercontent.com/audioCover=w512-h512" }
                                ]}
                            }},
                            "counterpart": [{ "counterpartRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": "videoVID",
                                "thumbnail": { "thumbnails": [
                                    { "url": "https://i.ytimg.com/vi/videoVID/hq720.jpg?sqp=x&rs=y" }
                                ]}
                            }}}]
                        }}
                    ]}}}
                }}}]}
            }}}
        });
        let url = extract_audio_counterpart_thumbnail(&data, "audioVID")
            .expect("must find audio thumbnail");
        assert!(url.starts_with("https://lh3.googleusercontent.com/"), "got {url}");
    }

    #[test]
    fn extract_audio_counterpart_video_id_returns_none_when_already_audio() {
        // User is on the audio side (primary = audio). There's no need to
        // switch — the videoId hop should return None.
        let data = json!({
            "contents": { "singleColumnMusicWatchNextResultsRenderer": { "tabbedRenderer": {
                "watchNextTabbedResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                    "musicQueueRenderer": { "content": { "playlistPanelRenderer": { "contents": [
                        { "playlistPanelVideoWrapperRenderer": {
                            "primaryRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": "audioVID",
                                "thumbnail": { "thumbnails": [
                                    { "url": "https://lh3.googleusercontent.com/audio=w512" }
                                ]}
                            }},
                            "counterpart": [{ "counterpartRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": "videoVID",
                                "thumbnail": { "thumbnails": [
                                    { "url": "https://i.ytimg.com/vi/videoVID/hq720.jpg?sqp=x&rs=y" }
                                ]}
                            }}}]
                        }}
                    ]}}}
                }}}]}
            }}}
        });
        assert!(extract_audio_counterpart_video_id(&data, "audioVID").is_none());
    }

    #[test]
    fn extract_audio_counterpart_meta_returns_none_for_unknown_video() {
        let data = json!({
            "contents": { "singleColumnMusicWatchNextResultsRenderer": { "tabbedRenderer": {
                "watchNextTabbedResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                    "musicQueueRenderer": { "content": { "playlistPanelRenderer": { "contents": [
                        { "playlistPanelVideoWrapperRenderer": {
                            "primaryRenderer": { "playlistPanelVideoRenderer": {
                                "videoId": "xxx",
                                "title": { "runs": [{ "text": "X" }] },
                                "longBylineText": { "runs": [{ "text": "Y" }] },
                                "lengthText": { "runs": [{ "text": "3:00" }] },
                                "thumbnail": { "thumbnails": [] }
                            }}
                        }}
                    ]}}}
                }}}]}
            }}}
        });
        assert!(extract_audio_counterpart_meta(&data, "different").is_none());
    }

    #[test]
    fn extract_audio_counterpart_returns_none_when_counterpart_id_matches_primary() {
        // Defensive: if YTM ever returns a self-counterpart, we should
        // not enter an infinite re-issue loop.
        let data = build_next_with_counterpart("sameId", "x", "sameId", "y");
        assert!(extract_audio_counterpart_video_id(&data, "sameId").is_none());
    }

    #[test]
    fn extract_upcoming_tracks_uses_counterpart_thumbnail_when_present() {
        // Two queue entries: one wraps a video with an audio counterpart
        // (counterpart's lh3 thumbnail must be picked); the other has no
        // counterpart (its own thumbnail must be picked).
        let with_counterpart = json!({
            "playlistPanelVideoWrapperRenderer": {
                "primaryRenderer": { "playlistPanelVideoRenderer": {
                    "videoId": "vidA",
                    "title": { "runs": [{ "text": "A" }] },
                    "longBylineText": { "runs": [{ "text": "Artist A" }] },
                    "lengthText": { "runs": [{ "text": "3:00" }] },
                    "thumbnail": { "thumbnails": [{ "url": "https://i.ytimg.com/vi/vidA/sd.jpg?sqp=x" }]}
                }},
                "counterpart": [{
                    "counterpartRenderer": {
                        "playlistPanelVideoRenderer": {
                            "videoId": "audA",
                            "thumbnail": { "thumbnails": [{ "url": "https://lh3.googleusercontent.com/audA=w512" }]}
                        }
                    }
                }]
            }
        });
        let without = json!({
            "playlistPanelVideoWrapperRenderer": {
                "primaryRenderer": { "playlistPanelVideoRenderer": {
                    "videoId": "vidB",
                    "title": { "runs": [{ "text": "B" }] },
                    "longBylineText": { "runs": [{ "text": "Artist B" }] },
                    "lengthText": { "runs": [{ "text": "3:00" }] },
                    "thumbnail": { "thumbnails": [{ "url": "https://lh3.googleusercontent.com/vidB=w512" }]}
                }}
            }
        });
        let data = json!({
            "contents": { "singleColumnMusicWatchNextResultsRenderer": { "tabbedRenderer": {
                "watchNextTabbedResultsRenderer": { "tabs": [{ "tabRenderer": { "content": {
                    "musicQueueRenderer": { "content": { "playlistPanelRenderer": { "contents": [
                        with_counterpart,
                        without,
                    ]}}}
                }}}]}
            }}}
        });
        let out = extract_upcoming_tracks(&data, "_seed_", 100);
        assert_eq!(out.len(), 2);
        // First entry: counterpart's lh3 URL was picked.
        assert_eq!(out[0].video_id, "vidA");
        assert!(
            out[0]
                .artwork_url
                .as_deref()
                .unwrap_or("")
                .contains("lh3.googleusercontent.com/audA"),
            "expected counterpart thumbnail, got {:?}",
            out[0].artwork_url
        );
        // Second entry: no counterpart, falls back to its own thumbnail.
        assert_eq!(out[1].video_id, "vidB");
        assert!(
            out[1]
                .artwork_url
                .as_deref()
                .unwrap_or("")
                .contains("lh3.googleusercontent.com/vidB"),
        );
    }

    // ---- v0.8.0: extract_audio_playlist_id (album OLAK lookup) ------------
    // Albums use an MPRE browseId that YTM does NOT accept as a watch
    // `&list=` parameter. The detail response surfaces an OLAK* id; the
    // Playing-queue panel and "Save to library" both depend on this.

    #[test]
    fn extract_audio_playlist_id_finds_olak_in_watch_endpoint() {
        let data = json!({
            "deeply": { "nested": {
                "watchEndpoint": { "playlistId": "OLAK5uy_abcdef123" }
            }}
        });
        assert_eq!(
            extract_audio_playlist_id(&data),
            Some("OLAK5uy_abcdef123".to_string())
        );
    }

    #[test]
    fn extract_audio_playlist_id_finds_rdclak() {
        let data = json!({
            "watchPlaylistEndpoint": { "playlistId": "RDCLAK5uy_xyz" }
        });
        assert_eq!(
            extract_audio_playlist_id(&data),
            Some("RDCLAK5uy_xyz".to_string())
        );
    }

    #[test]
    fn extract_audio_playlist_id_ignores_non_playable_prefixes() {
        // VL prefix is for browse, not watch — should NOT be returned.
        let data = json!({
            "watchEndpoint": { "playlistId": "VLPLnonsense" }
        });
        assert_eq!(extract_audio_playlist_id(&data), None);
    }

    #[test]
    fn extract_audio_playlist_id_returns_none_when_absent() {
        let data = json!({ "no": "playlist", "ids": "here" });
        assert_eq!(extract_audio_playlist_id(&data), None);
    }

    // ---- parse_episode_from_multi_row -------------------------------------
    //
    // Show / podcast pages emit episodes as `musicMultiRowListItemRenderer`
    // rather than the single-row renderer used by song-bearing playlists.
    // These tests pin the synthetic response shape so a future YTM tweak
    // doesn't silently break show pages.

    fn sample_multi_row_episode() -> serde_json::Value {
        json!({
            "title": { "runs": [{ "text": "Episode 7: A Long Talk" }] },
            "subtitle": {
                "runs": [
                    { "text": "Mar 1, 2026" },
                    { "text": " \u{2022} " },
                    { "text": "The Demo Show" }
                ]
            },
            "thumbnail": {
                "musicThumbnailRenderer": {
                    "thumbnail": {
                        "thumbnails": [
                            { "url": "https://i.ytimg.com/vi/eee/sm.jpg", "width": 60, "height": 60 },
                            { "url": "https://i.ytimg.com/vi/eee/lg.jpg", "width": 480, "height": 480 }
                        ]
                    }
                }
            },
            "onTap": { "watchEndpoint": { "videoId": "ep7videoid" } },
            "playbackProgress": {
                "musicPlaybackProgressRenderer": {
                    "durationText": { "runs": [{ "text": "42:15" }] }
                }
            }
        })
    }

    #[test]
    fn parse_episode_extracts_title_show_and_video_id() {
        let v = sample_multi_row_episode();
        let track = parse_episode_from_multi_row(&v).expect("episode");
        assert_eq!(track.video_id, "ep7videoid");
        assert_eq!(track.title, "Episode 7: A Long Talk");
        assert_eq!(track.artist, "The Demo Show");
        assert_eq!(track.album, "");
    }

    #[test]
    fn parse_episode_picks_best_thumbnail_url() {
        let v = sample_multi_row_episode();
        let track = parse_episode_from_multi_row(&v).expect("episode");
        // best_thumbnail returns the LAST entry — the 480px one.
        assert_eq!(
            track.artwork_url.as_deref(),
            Some("https://i.ytimg.com/vi/eee/lg.jpg"),
        );
    }

    #[test]
    fn parse_episode_parses_duration_text_to_seconds() {
        let v = sample_multi_row_episode();
        let track = parse_episode_from_multi_row(&v).expect("episode");
        // "42:15" → 42*60 + 15 = 2535 secs.
        assert!((track.duration_secs - 2535.0).abs() < 0.001);
    }

    #[test]
    fn parse_episode_uses_subtitle_verbatim_when_no_bullet_separator() {
        let v = json!({
            "title": { "runs": [{ "text": "Solo Episode" }] },
            "subtitle": { "runs": [{ "text": "The Demo Show" }] },
            "onTap": { "watchEndpoint": { "videoId": "vidx" } }
        });
        let track = parse_episode_from_multi_row(&v).expect("episode");
        assert_eq!(track.artist, "The Demo Show");
    }

    #[test]
    fn parse_episode_returns_none_when_title_empty() {
        let v = json!({
            "title": { "runs": [] },
            "subtitle": { "runs": [{ "text": "Show" }] },
            "onTap": { "watchEndpoint": { "videoId": "vidx" } }
        });
        assert!(parse_episode_from_multi_row(&v).is_none());
    }

    #[test]
    fn parse_episode_returns_none_when_no_video_id_anywhere() {
        // No `onTap`, no overlay play button, no flex columns —
        // nothing playable. Skip rather than emit a row that
        // no-ops on click.
        let v = json!({
            "title": { "runs": [{ "text": "Coming soon" }] },
            "subtitle": { "runs": [{ "text": "Show" }] }
        });
        assert!(parse_episode_from_multi_row(&v).is_none());
    }

    #[test]
    fn parse_episode_falls_back_to_overlay_video_id_when_on_tap_missing() {
        // Some show responses put the videoId in the
        // overlay → musicItemThumbnailOverlayRenderer → play button
        // path that `extract_video_id` understands.
        let v = json!({
            "title": { "runs": [{ "text": "Fallback Episode" }] },
            "subtitle": { "runs": [{ "text": "Show" }] },
            "overlay": {
                "musicItemThumbnailOverlayRenderer": {
                    "content": {
                        "musicPlayButtonRenderer": {
                            "playNavigationEndpoint": {
                                "watchEndpoint": { "videoId": "fallbackvid" }
                            }
                        }
                    }
                }
            }
        });
        let track = parse_episode_from_multi_row(&v).expect("episode");
        assert_eq!(track.video_id, "fallbackvid");
    }
}
