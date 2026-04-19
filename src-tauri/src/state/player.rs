use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<String>,
    pub album: String,
    pub album_id: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Buffering,
    #[default]
    Idle,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RepeatMode {
    #[default]
    None,
    One,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub name: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub status: PlaybackStatus,
    pub track: Option<TrackInfo>,
    pub position_secs: f64,
    pub volume: f64,
    pub is_liked: bool,
    pub repeat_mode: RepeatMode,
    pub is_shuffled: bool,
    pub queue: Vec<TrackInfo>,
    pub account: Option<AccountInfo>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            status: PlaybackStatus::Idle,
            track: None,
            position_secs: 0.0,
            volume: 1.0,
            is_liked: false,
            repeat_mode: RepeatMode::None,
            is_shuffled: false,
            queue: Vec::new(),
            account: None,
        }
    }
}

pub type SharedPlayerState = Arc<RwLock<PlayerState>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_info_serializes_with_camel_case_keys() {
        let info = AccountInfo {
            name: "Jane".into(),
            avatar_url: "https://example.test/a.jpg".into(),
        };
        let json = serde_json::to_value(&info).unwrap();
        // Frontend expects `avatarUrl`, not `avatar_url`.
        assert_eq!(json["name"], "Jane");
        assert_eq!(json["avatarUrl"], "https://example.test/a.jpg");
        assert!(json.get("avatar_url").is_none());
    }

    #[test]
    fn account_info_equality_enables_change_detection() {
        let a = AccountInfo { name: "A".into(), avatar_url: "u".into() };
        let b = AccountInfo { name: "A".into(), avatar_url: "u".into() };
        let c = AccountInfo { name: "A".into(), avatar_url: "v".into() };
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn player_state_default_has_no_account() {
        let state = PlayerState::default();
        assert!(state.account.is_none());
    }

    #[test]
    fn player_state_serializes_account_when_present() {
        let state = PlayerState {
            account: Some(AccountInfo {
                name: "Jane".into(),
                avatar_url: "u".into(),
            }),
            ..PlayerState::default()
        };
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["account"]["name"], "Jane");
    }
}
