pub mod types;

use serde_json::Value;
use tauri::AppHandle;

use crate::state::player::TrackInfo;
use crate::webview_bridge::api::ytm_api_call;

use self::types::*;

pub struct YtmApi;

impl YtmApi {
    pub fn new() -> Self {
        Self
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
        // Album IDs (MPRE...) must NOT have VL prefix
        // Playlist IDs (RDCLAK, PL, OLAK, etc.) MUST have VL prefix
        let browse_id = if playlist_id.starts_with("VL") || playlist_id.starts_with("MPRE") {
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
                    if let Ok(cont_data) = serde_json::from_str::<Value>(&cont_raw) {
                        let more = parse_continuation_shelves(&cont_data);
                        shelves.extend(more);
                        continuation = extract_continuation_token(&cont_data);
                    } else {
                        break;
                    }
                }
                Err(_) => break,
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
    let playlists = Vec::new();
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

    PlaylistDetail {
        playlist_id: playlist_id.to_string(),
        title,
        description,
        artwork_url,
        track_count,
        tracks,
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
}
