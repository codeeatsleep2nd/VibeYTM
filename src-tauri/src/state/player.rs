use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
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
    /// Podcast / show episode description blurb. Populated only by
    /// `parse_episode_from_multi_row`; absent on music tracks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Podcast / show episode publish-date display string (e.g.
    /// "Mar 1, 2026" or "3 days ago"). YTM-formatted; we don't parse it.
    /// Populated only for episodes; absent on music tracks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    /// YTM-internal id for THIS occurrence of the video in a specific
    /// playlist. Required by `browse/edit_playlist` with the
    /// `ACTION_REMOVE_VIDEO` action — `removedVideoId` alone isn't enough
    /// because a track can appear multiple times. Populated only when
    /// the track was parsed from a playlist detail response that carried
    /// `playlistItemData.playlistSetVideoId`; absent elsewhere.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_video_id: Option<String>,
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
    /// The playlist/album/radio context the user last started playing
    /// from. Persisted across restarts so the queue rebuild after launch
    /// uses the same `&list=…` parameter as the prior session.
    pub active_playlist_id: Option<String>,
    pub account: Option<AccountInfo>,
    /// Tri-state YTM sign-in status. None = unknown (bridge not yet loaded),
    /// Some(true) = signed in, Some(false) = signed out. Used on app launch
    /// to decide whether to skip the login page (issue #51) and to avoid
    /// rendering stale signed-in data after sign-out (issue #50).
    pub logged_in: Option<bool>,
    /// On launch, populated from the persisted session if a track was
    /// previously playing. The player commands check this BEFORE forwarding
    /// "play" to YTM — when set, they navigate the YTM webview to the
    /// saved track + position first (so the user resumes exactly where
    /// they left off). Cleared on first consumption or when the user
    /// explicitly navigates to a different track. Never persisted.
    #[serde(skip)]
    pub pending_restore: Option<PendingRestore>,
}

/// Saved playback context to restore on first user-initiated play after
/// app launch. Held in `PlayerState.pending_restore` and cleared once
/// consumed.
#[derive(Debug, Clone)]
pub struct PendingRestore {
    pub video_id: String,
    pub position_secs: f64,
    pub playlist_id: Option<String>,
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
            active_playlist_id: None,
            account: None,
            logged_in: None,
            pending_restore: None,
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
