//! Persist a small slice of PlayerState (last track + position + volume)
//! across app restarts so users don't lose their place. No autoplay — we
//! just re-populate the UI so the bottom player bar shows where they left
//! off; the user has to press Play to resume.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::time::sleep;

use crate::state::player::{SharedPlayerState, TrackInfo};

const SESSION_FILE: &str = "last_session.json";
const SAVE_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSession {
    pub track: Option<TrackInfo>,
    pub position_secs: f64,
    pub volume: f64,
    /// The playlist/album/radio context the user last had active. Used at
    /// next launch to restore YTM's queue (when the user presses Play
    /// we re-navigate with `&list=<active_playlist_id>` so YTM rebuilds
    /// the same queue context).
    #[serde(default)]
    pub active_playlist_id: Option<String>,
    /// Snapshot of the last-known queue (DOM-scraped from YTM by the
    /// bridge). Restored into `PlayerState.queue` so the panel renders
    /// content immediately on startup, before YTM has had time to rebuild
    /// the live queue.
    #[serde(default)]
    pub queue: Vec<TrackInfo>,
}

fn session_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(SESSION_FILE))
}

/// Read a persisted session from disk. Any IO or parse failure returns
/// None — persistence is best-effort.
pub fn load(app: &AppHandle) -> Option<PersistedSession> {
    let path = session_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    let session: PersistedSession = serde_json::from_slice(&bytes).ok()?;
    tracing::info!(
        track = ?session.track.as_ref().map(|t| t.title.as_str()),
        position = session.position_secs,
        "restored last session"
    );
    Some(session)
}

fn save_sync(app: &AppHandle, session: &PersistedSession) {
    let Some(path) = session_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_vec_pretty(session) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&path, &bytes) {
                tracing::warn!(error = %e, "failed to write session file");
            }
        }
        Err(e) => tracing::warn!(error = %e, "failed to serialize session"),
    }
}

/// Flush the current in-memory state to disk immediately. Called from the
/// window-close handler so the last-played track/position survives even if
/// the user closes the app within 5 seconds of starting playback (before the
/// periodic saver has had a chance to tick) — issue #24.
pub fn flush_now(app: &AppHandle, state: &SharedPlayerState) {
    let snapshot = {
        let player = tauri::async_runtime::block_on(async { state.read().await.clone() });
        PersistedSession {
            track: player.track.clone(),
            position_secs: player.position_secs,
            volume: player.volume,
            active_playlist_id: player.active_playlist_id.clone(),
            queue: player.queue.clone(),
        }
    };
    save_sync(app, &snapshot);
}

/// Apply a loaded session to in-memory state. Position and volume are
/// restored verbatim; playback status stays idle so nothing auto-plays.
pub async fn apply(state: &SharedPlayerState, session: PersistedSession) {
    let mut player = state.write().await;
    player.track = session.track;
    player.position_secs = session.position_secs;
    player.volume = session.volume;
    player.active_playlist_id = session.active_playlist_id;
    player.queue = session.queue;
}

/// Spawn a background task that snapshots current state to disk every
/// SAVE_INTERVAL, but only when something actually changed since the last
/// save. Runs for the life of the app handle.
pub fn spawn_saver(app: AppHandle, state: SharedPlayerState) {
    tauri::async_runtime::spawn(async move {
        let mut last_saved: Option<PersistedSession> = None;
        loop {
            sleep(SAVE_INTERVAL).await;
            let snapshot = {
                let player = state.read().await;
                PersistedSession {
                    track: player.track.clone(),
                    position_secs: player.position_secs,
                    volume: player.volume,
                    active_playlist_id: player.active_playlist_id.clone(),
                    queue: player.queue.clone(),
                }
            };
            if last_saved.as_ref() == Some(&snapshot) {
                continue;
            }
            save_sync(&app, &snapshot);
            last_saved = Some(snapshot);
        }
    });
}
