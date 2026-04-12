use serde::{Deserialize, Serialize};

use crate::state::player::{PlaybackStatus, TrackInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum AppEvent {
    TrackChanged(TrackInfo),
    PlaybackStatusChanged(PlaybackStatus),
    PositionUpdated(f64),
    VolumeChanged(f64),
    PlaybackCommand(PlaybackCommand),
    IntegrationError { source: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackCommand {
    Play,
    Pause,
    TogglePlay,
    Next,
    Previous,
    SeekTo(f64),
    SetVolume(f64),
    Like,
    Dislike,
}
