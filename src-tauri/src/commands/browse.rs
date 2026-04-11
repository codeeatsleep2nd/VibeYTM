use tauri::State;

use crate::ytm_api::YtmApi;
use crate::ytm_api::types::*;

#[tauri::command]
pub async fn search(query: String, api: State<'_, YtmApi>) -> Result<SearchResults, String> {
    api.search(&query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_home(api: State<'_, YtmApi>) -> Result<Vec<Shelf>, String> {
    api.get_home().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_library_playlists(
    api: State<'_, YtmApi>,
) -> Result<Vec<PlaylistSummary>, String> {
    api.get_library_playlists()
        .await
        .map_err(|e| e.to_string())
}
