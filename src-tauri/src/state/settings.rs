use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub integrations: IntegrationSettings,
    pub shortcuts: ShortcutSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub close_to_tray: bool,
    pub background_playback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationSettings {
    pub notifications_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
            },
            integrations: IntegrationSettings {
                notifications_enabled: true,
            },
            shortcuts: ShortcutSettings {
                play_pause: "CommandOrControl+Shift+Space".into(),
                next_track: "CommandOrControl+Shift+Right".into(),
                prev_track: "CommandOrControl+Shift+Left".into(),
            },
        }
    }
}
