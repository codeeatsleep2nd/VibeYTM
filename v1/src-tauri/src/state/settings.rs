//! User-editable app settings. Persisted to `{app_data}/settings.json` so
//! choices like "close to tray" survive restarts and can be read from the
//! window-event handler at close time.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub integrations: IntegrationSettings,
    pub shortcuts: ShortcutSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub close_to_tray: bool,
    pub background_playback: bool,
    /// Volume the user last left the app at, in the range [0.0, 1.0].
    /// Used to restore audio level on next startup and to push back into
    /// YTM whenever YTM's <video> element resets it across track changes.
    /// Defaults to 1.0 (full volume) on a clean install.
    #[serde(default = "default_volume")]
    pub last_volume: f64,
}

fn default_volume() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationSettings {
    pub notifications_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutSettings {
    pub play_pause: String,
    pub next_track: String,
    pub prev_track: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            general: GeneralSettings {
                close_to_tray: true,
                background_playback: true,
                last_volume: default_volume(),
            },
            integrations: IntegrationSettings {
                notifications_enabled: true,
            },
            shortcuts: ShortcutSettings {
                play_pause: "CommandOrControl+Shift+Space".into(),
                next_track: "CommandOrControl+Alt+Right".into(),
                prev_track: "CommandOrControl+Alt+Left".into(),
            },
        }
    }
}

pub type SharedSettings = Arc<RwLock<AppSettings>>;

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(SETTINGS_FILE))
}

/// Load settings from disk; fall back to defaults if missing/corrupt. This
/// is intentionally sync so it can run before the async runtime is spun up.
pub fn load(app: &AppHandle) -> AppSettings {
    let Some(path) = settings_path(app) else {
        return AppSettings::default();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return AppSettings::default();
    };
    match serde_json::from_slice::<AppSettings>(&bytes) {
        Ok(settings) => settings,
        Err(e) => {
            tracing::warn!(error = %e, "failed to parse settings.json, using defaults");
            AppSettings::default()
        }
    }
}

pub fn save(app: &AppHandle, settings: &AppSettings) {
    let Some(path) = settings_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_vec_pretty(settings) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&path, &bytes) {
                tracing::warn!(error = %e, "failed to write settings.json");
            }
        }
        Err(e) => tracing::warn!(error = %e, "failed to serialize settings"),
    }
}

/// Read a snapshot of the current settings synchronously by briefly
/// blocking on the Tokio RwLock. Used by window-event handlers that can't
/// await. The read is short (microseconds) and contention is negligible
/// since writes only happen when the user flips a toggle.
pub fn read_blocking(state: &SharedSettings) -> AppSettings {
    tauri::async_runtime::block_on(async { state.read().await.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_has_close_to_tray_enabled() {
        let s = AppSettings::default();
        assert!(s.general.close_to_tray);
        assert!(s.general.background_playback);
        assert!(s.integrations.notifications_enabled);
    }

    #[test]
    fn roundtrips_via_json() {
        let mut s = AppSettings::default();
        s.general.close_to_tray = false;
        let bytes = serde_json::to_vec(&s).unwrap();
        let parsed: AppSettings = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed, s);
    }

    #[test]
    fn serializes_with_camel_case_keys() {
        let s = AppSettings::default();
        let v = serde_json::to_value(&s).unwrap();
        assert!(v["general"]["closeToTray"].is_boolean());
        assert!(v["general"]["backgroundPlayback"].is_boolean());
        assert!(v["integrations"]["notificationsEnabled"].is_boolean());
    }
}
