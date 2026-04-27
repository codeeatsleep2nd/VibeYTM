use tauri::{AppHandle, State};

use crate::cache::Cache;
use crate::state::player::TrackInfo;
use crate::ytm_api::types::*;
use crate::ytm_api::YtmApi;

/// Save any tracks that carry a valid duration into the disk cache and
/// backfill zero-duration tracks from the cache. This makes durations sticky
/// across sessions and across shelves that don't ship them (e.g. home page).
fn enrich_tracks(cache: &Cache, tracks: &mut [TrackInfo]) {
    for t in tracks.iter_mut() {
        if t.video_id.is_empty() {
            continue;
        }
        if t.duration_secs > 0.0 {
            cache.put_track_duration(&t.video_id, t.duration_secs);
        } else if let Some(cached) = cache.get_track_duration(&t.video_id) {
            t.duration_secs = cached;
        }
    }
}

fn enrich_shelves(cache: &Cache, shelves: &mut [Shelf]) {
    for shelf in shelves.iter_mut() {
        if let ShelfContent::Songs(songs) = &mut shelf.items {
            enrich_tracks(cache, songs);
        }
    }
}

#[tauri::command]
pub async fn search_suggestions(
    query: String,
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<Vec<String>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    api.search_suggestions(&app, &query).await.map_err(|e| {
        tracing::warn!(error = %e, "browse::search_suggestions failed");
        e.to_string()
    })
}

#[tauri::command]
pub async fn search(
    query: String,
    filter: Option<String>,
    app: AppHandle,
    api: State<'_, YtmApi>,
    cache: State<'_, Cache>,
) -> Result<SearchResults, String> {
    tracing::info!(query = %query, filter = ?filter, "browse::search called");

    let is_unfiltered = filter.is_none();
    let mut result = api.search(&app, &query, filter).await.map_err(|e| {
        tracing::error!(error = %e, "browse::search failed");
        e.to_string()
    })?;
    enrich_tracks(&cache, &mut result.songs);

    // For an unfiltered search, the inline album list is curated and rarely
    // contains the artist's latest release. Fire a separate ALBUMS-filtered
    // search to get the full album list, then pick the one with the highest
    // year as the unified-view "top album".
    if is_unfiltered {
        let albums_filter = "EgWKAQIYAWoSEA4QCRAKEAUQBBADEBUQEBAR".to_string();
        match api
            .search(&app, &query, Some(albums_filter))
            .await
        {
            Ok(albums_result) => {
                let latest = albums_result
                    .albums
                    .into_iter()
                    .filter(|a| a.browse_id.starts_with("MPRE"))
                    .max_by_key(|a| {
                        a.year
                            .as_deref()
                            .and_then(|y| y.parse::<u32>().ok())
                            .unwrap_or(0)
                    });
                if let Some(latest) = latest {
                    result.top_album = Some(latest);
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "albums-filtered search failed");
            }
        }
    }

    tracing::info!(
        songs = result.songs.len(),
        albums = result.albums.len(),
        top_album = ?result.top_album.as_ref().map(|a| (a.title.as_str(), a.year.as_deref().unwrap_or(""), a.browse_id.as_str())),
        "browse::search done"
    );
    Ok(result)
}

#[tauri::command]
pub async fn get_home(
    app: AppHandle,
    api: State<'_, YtmApi>,
    cache: State<'_, Cache>,
) -> Result<Vec<Shelf>, String> {
    tracing::info!("browse::get_home called");
    let mut result = api.get_home(&app).await.map_err(|e| {
        tracing::error!(error = %e, "browse::get_home failed");
        e.to_string()
    })?;
    enrich_shelves(&cache, &mut result);
    tracing::info!(shelves = result.len(), "browse::get_home done");
    Ok(result)
}

#[tauri::command]
pub async fn get_explore(
    app: AppHandle,
    api: State<'_, YtmApi>,
    cache: State<'_, Cache>,
) -> Result<Vec<Shelf>, String> {
    tracing::info!("browse::get_explore called");
    let mut result = api.get_explore(&app).await.map_err(|e| {
        tracing::error!(error = %e, "browse::get_explore failed");
        e.to_string()
    })?;
    enrich_shelves(&cache, &mut result);
    tracing::info!(shelves = result.len(), "browse::get_explore done");
    Ok(result)
}

#[tauri::command]
pub async fn get_playlist(
    playlist_id: String,
    app: AppHandle,
    api: State<'_, YtmApi>,
    cache: State<'_, Cache>,
) -> Result<PlaylistDetail, String> {
    tracing::info!(playlist_id = %playlist_id, "browse::get_playlist called");
    let mut result = api.get_playlist(&app, &playlist_id).await.map_err(|e| {
        tracing::error!(error = %e, "browse::get_playlist failed");
        e.to_string()
    })?;
    enrich_tracks(&cache, &mut result.tracks);
    tracing::info!(tracks = result.tracks.len(), "browse::get_playlist done");
    Ok(result)
}

#[tauri::command]
pub async fn get_library_playlists(
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<Vec<PlaylistSummary>, String> {
    tracing::info!("browse::get_library_playlists called");
    let result = api.get_library_playlists(&app).await.map_err(|e| {
        tracing::error!(error = %e, "browse::get_library_playlists failed");
        e.to_string()
    })?;
    tracing::info!(playlists = result.len(), "browse::get_library_playlists done");
    Ok(result)
}

#[tauri::command]
pub async fn get_library_songs(
    app: AppHandle,
    api: State<'_, YtmApi>,
    cache: State<'_, Cache>,
) -> Result<Vec<TrackInfo>, String> {
    tracing::info!("browse::get_library_songs called");
    let mut result = api.get_library_songs(&app).await.map_err(|e| {
        tracing::error!(error = %e, "browse::get_library_songs failed");
        e.to_string()
    })?;
    enrich_tracks(&cache, &mut result);
    tracing::info!(songs = result.len(), "browse::get_library_songs done");
    Ok(result)
}

#[tauri::command]
pub async fn get_library_albums(
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<Vec<AlbumSummary>, String> {
    tracing::info!("browse::get_library_albums called");
    let result = api.get_library_albums(&app).await.map_err(|e| {
        tracing::error!(error = %e, "browse::get_library_albums failed");
        e.to_string()
    })?;
    tracing::info!(albums = result.len(), "browse::get_library_albums done");
    Ok(result)
}

#[tauri::command]
pub async fn get_library_artists(
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<Vec<ArtistSummary>, String> {
    tracing::info!("browse::get_library_artists called");
    let result = api.get_library_artists(&app).await.map_err(|e| {
        tracing::error!(error = %e, "browse::get_library_artists failed");
        e.to_string()
    })?;
    tracing::info!(artists = result.len(), "browse::get_library_artists done");
    Ok(result)
}

#[tauri::command]
pub async fn get_library_podcasts(
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<Vec<PodcastSummary>, String> {
    tracing::info!("browse::get_library_podcasts called");
    let result = api.get_library_podcasts(&app).await.map_err(|e| {
        tracing::error!(error = %e, "browse::get_library_podcasts failed");
        e.to_string()
    })?;
    tracing::info!(podcasts = result.len(), "browse::get_library_podcasts done");
    Ok(result)
}

#[tauri::command]
pub async fn get_podcast_last_episode(
    browse_id: String,
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<Option<PodcastLastEpisode>, String> {
    tracing::info!(%browse_id, "browse::get_podcast_last_episode called");
    let result = api.get_podcast_last_episode(&app, &browse_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, %browse_id, "browse::get_podcast_last_episode failed");
            e.to_string()
        })?;
    tracing::info!(
        %browse_id,
        found = result.is_some(),
        display = result.as_ref().map(|r| r.display.as_str()).unwrap_or(""),
        secs_ago = ?result.as_ref().and_then(|r| r.secs_ago),
        "browse::get_podcast_last_episode done"
    );
    Ok(result)
}

#[tauri::command]
pub async fn save_playlist_to_library(
    playlist_id: String,
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<(), String> {
    tracing::info!(playlist_id = %playlist_id, "browse::save_playlist_to_library called");
    let result = api.save_playlist_to_library(&app, &playlist_id).await.map_err(|e| {
        tracing::error!(error = %e, "browse::save_playlist_to_library failed");
        e.to_string()
    });
    // Mutation: drop the entire YTM API cache so the next library /
    // playlist fetch reflects the new "saved" state instead of the
    // pre-mutation snapshot. Coarse but correct — the cache is small
    // (50 entries) so a full rebuild is cheap.
    if result.is_ok() {
        crate::webview_bridge::api_cache::clear_all().await;
    }
    result
}

#[tauri::command]
pub async fn remove_playlist_from_library(
    playlist_id: String,
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<(), String> {
    tracing::info!(playlist_id = %playlist_id, "browse::remove_playlist_from_library called");
    let result = api.remove_playlist_from_library(&app, &playlist_id).await.map_err(|e| {
        tracing::error!(error = %e, "browse::remove_playlist_from_library failed");
        e.to_string()
    });
    if result.is_ok() {
        crate::webview_bridge::api_cache::clear_all().await;
    }
    result
}

#[tauri::command]
pub async fn get_upcoming_tracks(
    video_id: String,
    limit: Option<usize>,
    playlist_id: Option<String>,
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<Vec<TrackInfo>, String> {
    let limit = limit.unwrap_or(3).min(200);
    tracing::info!(
        video_id = %video_id,
        limit,
        playlist_id = ?playlist_id,
        "browse::get_upcoming_tracks called"
    );
    let result = api
        .get_upcoming_tracks(&app, &video_id, limit, playlist_id.as_deref())
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "browse::get_upcoming_tracks failed");
            e.to_string()
        })?;
    tracing::info!(count = result.len(), "browse::get_upcoming_tracks done");
    Ok(result)
}

/// Look up the audio counterpart's album-art thumbnail for a videoId.
/// YTM matches every official music video (`MUSIC_VIDEO_TYPE_OMV`) to
/// its audio track (`MUSIC_VIDEO_TYPE_ATV`); the audio side carries
/// the `lh*.googleusercontent.com` square album cover, while the
/// video side has the 16:9 video frame. Returns `Some(url)` only
/// when a counterpart exists and its thumbnail differs from what
/// YTM would have shown for the video. Returns `None` for tracks
/// that already ARE the audio side, or when YTM hasn't matched the
/// video to an audio counterpart.
#[tauri::command]
pub async fn get_audio_counterpart_artwork(
    video_id: String,
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<Option<String>, String> {
    tracing::info!(video_id = %video_id, "browse::get_audio_counterpart_artwork called");
    // Note: an earlier version of this command tried to abort when the
    // player_state's `track.video_id` differed from the requested
    // `video_id` ("the user must have skipped"). That was wrong:
    // player_state lags the bridge by one poller cycle, so the
    // request often arrives BEFORE player_state catches up to the
    // new track — the abort fired incorrectly, returned Ok(None),
    // and the frontend cached null for that videoId. The OnceCell
    // de-dupe in `YtmApi::fetch_next_cached` already guarantees
    // concurrent calls for the same body share one fetch, so
    // there's no work-multiplication to defend against.
    let result = api
        .get_audio_counterpart_artwork(&app, &video_id)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "browse::get_audio_counterpart_artwork failed");
            e.to_string()
        })?;
    tracing::info!(
        video_id = %video_id,
        found = result.is_some(),
        "browse::get_audio_counterpart_artwork done"
    );
    Ok(result)
}

/// Loose case-insensitive substring match used by the cache-read sanity
/// check. Returns true when `a` and `b` share a non-empty substring in
/// either direction (handles partial title/artist variants like
/// "ROSÉ" vs "ROSÉ (with Bruno Mars)" or "周杰倫" vs "Jay Chou 周杰倫").
fn lyric_field_matches(a: &str, b: &str) -> bool {
    let al = a.trim().to_lowercase();
    let bl = b.trim().to_lowercase();
    if al.is_empty() || bl.is_empty() {
        return false;
    }
    al.contains(&bl) || bl.contains(&al)
}

/// Decide whether a cached `Lyrics` entry is still valid for the playing
/// track. Returns `true` when (1) we have no `matched_artist` / `matched_title`
/// metadata to compare against — happens for entries cached BEFORE this
/// stamping was added; we trust them — or (2) BOTH the cached artist and
/// the cached title loosely match the request. Any mismatch means an old
/// session matched a different song's lyrics to this videoId; the caller
/// re-fetches.
fn cached_lyrics_matches_request(
    cached: &Lyrics,
    request_artist: Option<&str>,
    request_title: Option<&str>,
) -> bool {
    let (cached_artist, cached_title) =
        match (cached.matched_artist.as_deref(), cached.matched_title.as_deref()) {
            (Some(a), Some(t)) if !a.trim().is_empty() && !t.trim().is_empty() => (a, t),
            _ => return true, // pre-stamping entry — trust it
        };
    let req_artist = request_artist.unwrap_or("");
    let req_title = request_title.unwrap_or("");
    // Both halves must agree. Title-only or artist-only matches were the
    // exact failure mode that produced the wrong-song lyrics regression
    // (NetEase's title-substring search returning a different artist's
    // track with the same title).
    lyric_field_matches(cached_artist, req_artist)
        && lyric_field_matches(cached_title, req_title)
}

/// `force_external` (camelCase from FE: `forceExternal`) is `Some(true)` when
/// the user clicked the "Refresh lyrics" button. We then skip BOTH the disk
/// cache AND the YTM-synced-lyrics short-circuit, going straight to the
/// LRCLIB/NetEase race. The lyrics tab YTM exposes for some videoIds returns
/// wrong-but-synced content; without this flag, refreshing just re-fetches
/// from the same wrong YTM source.
#[tauri::command]
pub async fn get_lyrics(
    video_id: String,
    artist: Option<String>,
    title: Option<String>,
    duration_secs: Option<f64>,
    force_external: Option<bool>,
    app: AppHandle,
    api: State<'_, YtmApi>,
    cache: State<'_, Cache>,
) -> Result<Lyrics, String> {
    let force_external = force_external.unwrap_or(false);
    tracing::info!(video_id = %video_id, force_external, "browse::get_lyrics called");

    // Disk cache hit? Return immediately — no network round-trip, survives
    // app restarts. The cache's 7d+jitter TTL handles freshness. Skipped
    // when the user clicked Refresh: they explicitly want a fresh result.
    //
    // Sanity check: when the cached entry's `matched_artist`/`matched_title`
    // disagrees with the playing track's request artist/title (e.g. an
    // earlier session matched the wrong song via NetEase's loose search),
    // treat the entry as stale and re-fetch + re-cache instead of serving
    // the lie indefinitely.
    if !force_external {
        if let Ok(Some(raw)) = cache.get_lyrics(&video_id) {
            if let Ok(cached) = serde_json::from_str::<Lyrics>(&raw) {
                if cached_lyrics_matches_request(
                    &cached,
                    artist.as_deref(),
                    title.as_deref(),
                ) {
                    tracing::info!(video_id = %video_id, "browse::get_lyrics served from disk cache");
                    return Ok(cached);
                }
                tracing::info!(
                    video_id = %video_id,
                    cached_artist = ?cached.matched_artist,
                    cached_title = ?cached.matched_title,
                    request_artist = ?artist,
                    request_title = ?title,
                    "browse::get_lyrics: cached entry mismatches request — re-fetching"
                );
                if let Err(e) = cache.invalidate_lyrics(&video_id) {
                    tracing::warn!(error = %e, "failed to drop stale lyrics cache entry");
                }
            }
        }
    }

    let result = api
        .get_lyrics(
            &app,
            &video_id,
            artist.as_deref(),
            title.as_deref(),
            duration_secs,
            force_external,
        )
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "browse::get_lyrics failed");
            e.to_string()
        })?;

    // Persist only meaningful results. Empty stubs are left un-cached so a
    // later probe (with better title cleaning or once LRCLIB re-indexes)
    // can still populate the track.
    let has_text = !result.text.trim().is_empty();
    let has_lines = result.lines.as_ref().map_or(false, |l| !l.is_empty());
    if has_text || has_lines {
        if let Ok(json) = serde_json::to_string(&result) {
            if let Err(e) = cache.put_lyrics(&video_id, &json) {
                tracing::warn!(error = %e, "failed to persist lyrics cache");
            }
        }
    }

    Ok(result)
}

/// Remove the disk-cache entry for a single videoId so the next
/// `get_lyrics` call goes back to YTM/LRCLIB/NetEase. The FE clears its
/// in-memory + localStorage caches separately — both layers must be
/// invalidated in lockstep, otherwise the FE returns its stale hit
/// without ever calling Rust again.
#[tauri::command]
pub fn invalidate_lyrics_cache(
    video_id: String,
    cache: State<'_, Cache>,
) -> Result<(), String> {
    tracing::info!(video_id = %video_id, "invalidate_lyrics_cache");
    cache.invalidate_lyrics(&video_id).map_err(|e| {
        tracing::warn!(error = %e, "failed to invalidate lyrics cache");
        e.to_string()
    })
}
