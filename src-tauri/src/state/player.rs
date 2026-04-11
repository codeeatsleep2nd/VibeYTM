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
        }
    }
}

pub type SharedPlayerState = Arc<RwLock<PlayerState>>;
