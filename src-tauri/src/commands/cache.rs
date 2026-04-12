//! Tauri commands for the disk cache.

use tauri::State;

use crate::cache::{Cache, CacheStats};

#[tauri::command]
pub async fn cache_fetch_image(
    cache: State<'_, Cache>,
    url: String,
) -> Result<String, String> {
    let path = cache
        .get_or_fetch_image(&url)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn cache_clear(cache: State<'_, Cache>) -> Result<u64, String> {
    cache.clear().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cache_stats(cache: State<'_, Cache>) -> Result<CacheStats, String> {
    cache.stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cache_get_track(
    cache: State<'_, Cache>,
    video_id: String,
) -> Result<Option<String>, String> {
    cache.get_track(&video_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cache_put_track(
    cache: State<'_, Cache>,
    video_id: String,
    json: String,
) -> Result<(), String> {
    cache.put_track(&video_id, &json).map_err(|e| e.to_string())
}
