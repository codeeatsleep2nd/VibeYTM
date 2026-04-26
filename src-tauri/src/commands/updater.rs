//! Tauri command bridging the frontend's "Check for updates" button to the
//! `updater` module's GitHub release lookup.

use tauri::AppHandle;

use crate::updater::{check_once, UpdateInfo};

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    check_once(&current).await
}
