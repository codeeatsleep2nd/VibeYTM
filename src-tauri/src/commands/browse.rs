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
pub async fn save_playlist_to_library(
    playlist_id: String,
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<(), String> {
    tracing::info!(playlist_id = %playlist_id, "browse::save_playlist_to_library called");
    api.save_playlist_to_library(&app, &playlist_id).await.map_err(|e| {
        tracing::error!(error = %e, "browse::save_playlist_to_library failed");
        e.to_string()
    })
}

#[tauri::command]
pub async fn remove_playlist_from_library(
    playlist_id: String,
    app: AppHandle,
    api: State<'_, YtmApi>,
) -> Result<(), String> {
    tracing::info!(playlist_id = %playlist_id, "browse::remove_playlist_from_library called");
    api.remove_playlist_from_library(&app, &playlist_id).await.map_err(|e| {
        tracing::error!(error = %e, "browse::remove_playlist_from_library failed");
        e.to_string()
    })
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

#[tauri::command]
pub async fn get_lyrics(
    video_id: String,
    artist: Option<String>,
    title: Option<String>,
    duration_secs: Option<f64>,
    app: AppHandle,
    api: State<'_, YtmApi>,
    cache: State<'_, Cache>,
) -> Result<Lyrics, String> {
    tracing::info!(video_id = %video_id, "browse::get_lyrics called");

    // Disk cache hit? Return immediately — no network round-trip, survives
    // app restarts. The cache's 7d+jitter TTL handles freshness.
    if let Ok(Some(raw)) = cache.get_lyrics(&video_id) {
        if let Ok(cached) = serde_json::from_str::<Lyrics>(&raw) {
            tracing::info!(video_id = %video_id, "browse::get_lyrics served from disk cache");
            return Ok(cached);
        }
    }

    let result = api
        .get_lyrics(&app, &video_id, artist.as_deref(), title.as_deref(), duration_secs)
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
