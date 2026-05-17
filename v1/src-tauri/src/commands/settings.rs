use tauri::{AppHandle, State};

use crate::state::settings::{self, AppSettings, SharedSettings};

#[tauri::command]
pub async fn get_settings(
    state: State<'_, SharedSettings>,
) -> Result<AppSettings, String> {
    Ok(state.read().await.clone())
}

#[tauri::command]
pub async fn set_settings(
    new: AppSettings,
    state: State<'_, SharedSettings>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut s = state.write().await;
        *s = new.clone();
    }
    // Persist eagerly: the primary reason to flip "close to tray" is to see
    // the new behavior on the very next close. A delayed debounce would
    // miss that intent, and the payload is tiny (~250 B).
    settings::save(&app, &new);
    Ok(())
}
