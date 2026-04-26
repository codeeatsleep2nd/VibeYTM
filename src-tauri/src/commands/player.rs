use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::cache::Cache;
use crate::events::bus::EventBus;
use crate::events::types::AppEvent;
use crate::state::player::{AccountInfo, PlaybackStatus, PlayerState, RepeatMode, SharedPlayerState, TrackInfo};
use crate::state::settings::{self, SharedSettings};

#[tauri::command]
pub async fn on_track_changed(
    track: TrackInfo,
    state: State<'_, SharedPlayerState>,
    bus: State<'_, Arc<EventBus>>,
    cache: State<'_, Cache>,
    app: AppHandle,
) -> Result<(), String> {
    // Persist duration so home/search shelves (which don't ship durations)
    // can backfill this track in future responses.
    if track.duration_secs > 0.0 && !track.video_id.is_empty() {
        cache.put_track_duration(&track.video_id, track.duration_secs);
    }

    {
        let mut player = state.write().await;
        player.track = Some(track.clone());
    }

    bus.emit(AppEvent::TrackChanged(track.clone()));
    app.emit("player:track-changed", &track)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Called from the YTM bridge whenever its DOM queue observer detects a
/// change. Stores the authoritative queue (the order YTM will actually play
/// tracks in, including shuffle state) so the Playing-queue UI can show the
/// real up-next list instead of re-fetching a separate /next snapshot that
/// may diverge from YTM's internal ordering.
#[tauri::command]
pub async fn on_queue_changed(
    queue: Vec<TrackInfo>,
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut player = state.write().await;
        player.queue = queue.clone();
    }
    app.emit("player:queue-changed", &queue)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn on_playback_status_changed(
    status: PlaybackStatus,
    state: State<'_, SharedPlayerState>,
    bus: State<'_, Arc<EventBus>>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut player = state.write().await;
        player.status = status;
    }

    bus.emit(AppEvent::PlaybackStatusChanged(status));
    app.emit("player:status-changed", &status)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn on_position_updated(
    position: f64,
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut player = state.write().await;
    player.position_secs = position;
    // Emit to frontend so the progress bar updates
    let _ = app.emit("player:position", &position);
    Ok(())
}

#[tauri::command]
pub async fn get_player_state(
    state: State<'_, SharedPlayerState>,
) -> Result<PlayerState, String> {
    let player = state.read().await;
    Ok(player.clone())
}

#[tauri::command]
pub async fn get_account_info(
    state: State<'_, SharedPlayerState>,
) -> Result<Option<AccountInfo>, String> {
    let player = state.read().await;
    Ok(player.account.clone())
}

/// Returns the YTM sign-in state as last observed by the bridge poller.
/// Tri-state: None = bridge hasn't reported yet; Some(true) = signed in;
/// Some(false) = signed out. Used by the frontend on launch to skip the
/// login gate when the user is already authenticated (issue #51).
#[tauri::command]
pub async fn get_login_state(
    state: State<'_, SharedPlayerState>,
) -> Result<Option<bool>, String> {
    let player = state.read().await;
    Ok(player.logged_in)
}

// --- Queue management ---

#[tauri::command]
pub async fn add_to_queue(
    track: TrackInfo,
    state: State<'_, SharedPlayerState>,
) -> Result<(), String> {
    let mut player = state.write().await;
    player.queue.push(track);
    Ok(())
}

#[tauri::command]
pub async fn remove_from_queue(
    index: usize,
    state: State<'_, SharedPlayerState>,
) -> Result<(), String> {
    let mut player = state.write().await;
    if index >= player.queue.len() {
        return Err(format!(
            "index {index} out of bounds (queue length: {})",
            player.queue.len()
        ));
    }
    player.queue.remove(index);
    Ok(())
}

#[tauri::command]
pub async fn clear_queue(state: State<'_, SharedPlayerState>) -> Result<(), String> {
    let mut player = state.write().await;
    player.queue.clear();
    Ok(())
}

#[tauri::command]
pub async fn reorder_queue(
    from: usize,
    to: usize,
    state: State<'_, SharedPlayerState>,
) -> Result<(), String> {
    let mut player = state.write().await;
    let len = player.queue.len();
    if from >= len || to >= len {
        return Err(format!(
            "indices out of bounds: from={from}, to={to}, queue length={len}"
        ));
    }
    let item = player.queue.remove(from);
    player.queue.insert(to, item);
    Ok(())
}

// --- Direct playback commands (forwarded to YTM window) ---

fn forward_to_ytm(app: &AppHandle, cmd: &str) {
    if let Some(window) = crate::webview_bridge::get_ytm_window(app) {
        if let Err(e) = crate::webview_bridge::exec_playback_command(&window, cmd) {
            tracing::warn!(command = cmd, error = %e, "failed to forward command to YTM");
        }
    }
}

/// Pop a `pending_restore` if one is queued (set on launch from the
/// persisted session). When present, the caller should navigate the YTM
/// webview to the saved track at the saved position INSTEAD of forwarding
/// a generic "play" command — otherwise the YTM webview is still on the
/// home page and "play" is a no-op.
async fn take_pending_restore(
    state: &SharedPlayerState,
) -> Option<crate::state::player::PendingRestore> {
    let mut player = state.write().await;
    player.pending_restore.take()
}

#[tauri::command]
pub async fn play(
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    if let Some(restore) = take_pending_restore(&state).await {
        return navigate_for_restore(&app, &restore);
    }
    forward_to_ytm(&app, "play");
    Ok(())
}

#[tauri::command]
pub async fn pause(app: AppHandle) -> Result<(), String> {
    forward_to_ytm(&app, "pause");
    Ok(())
}

#[tauri::command]
pub async fn toggle_play(
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    if let Some(restore) = take_pending_restore(&state).await {
        return navigate_for_restore(&app, &restore);
    }
    forward_to_ytm(&app, "toggle_play");
    Ok(())
}

#[tauri::command]
pub async fn next_track(
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    // User navigated explicitly — discard any pending restore so we don't
    // jump back to the previous track on the next play.
    take_pending_restore(&state).await;
    forward_to_ytm(&app, "next");
    Ok(())
}

#[tauri::command]
pub async fn previous_track(
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    take_pending_restore(&state).await;
    forward_to_ytm(&app, "previous");
    Ok(())
}

/// Navigate the YTM webview to the saved track at the saved position so
/// the YouTube Music engine resumes from the persisted offset. The
/// `&t=Ns` URL parameter is honored by YT, and YTM will autoplay (which
/// is what the user wants when they hit Play after launch).
fn navigate_for_restore(
    app: &AppHandle,
    restore: &crate::state::player::PendingRestore,
) -> Result<(), String> {
    let Some(window) = crate::webview_bridge::get_ytm_window(app) else {
        return Ok(());
    };
    let position_secs = restore.position_secs.max(0.0) as u64;
    crate::webview_bridge::navigate_to_track_at_position(
        &window,
        &restore.video_id,
        position_secs,
        restore.playlist_id.as_deref(),
    )
}

// --- Playback controls ---

#[tauri::command]
pub async fn play_track(
    video_id: String,
    playlist_id: Option<String>,
    state: State<'_, SharedPlayerState>,
    bus: State<'_, Arc<EventBus>>,
    app: AppHandle,
) -> Result<(), String> {
    tracing::info!(video_id = %video_id, playlist_id = ?playlist_id, "play_track called");
    if video_id.is_empty() {
        return Err("video_id is empty".into());
    }
    // Navigate the YTM window to the track using the fast (no-reload) path
    if let Some(window) = crate::webview_bridge::get_ytm_window(&app) {
        if let Some(ref list_id) = playlist_id {
            crate::webview_bridge::navigate_to_track_with_playlist(&window, &video_id, list_id)?;
        } else {
            crate::webview_bridge::navigate_to_track(&window, &video_id)?;
        }
    }

    // Create initial track info (will be updated by the JS bridge once page loads)
    let track = TrackInfo {
        title: "Loading...".to_string(),
        artist: String::new(),
        artist_id: None,
        album: String::new(),
        album_id: None,
        artwork_url: Some(format!(
            "https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
        )),
        duration_secs: 0.0,
        video_id,
    };

    {
        let mut player = state.write().await;
        player.track = Some(track.clone());
        player.status = PlaybackStatus::Playing;
        player.position_secs = 0.0;
        // Stash the watch-list context so the periodic session saver can
        // persist it; on next launch the queue can be rebuilt by routing
        // YTM through the same `&list=` parameter.
        player.active_playlist_id = playlist_id.clone();
        // User explicitly picked a different track — drop any pending
        // restore so we don't jump back to the previously-saved track on
        // the next play.
        player.pending_restore = None;
    }

    bus.emit(AppEvent::TrackChanged(track.clone()));
    app.emit("player:track-changed", &track)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn set_volume(
    level: f64,
    state: State<'_, SharedPlayerState>,
    settings_state: State<'_, SharedSettings>,
    app: AppHandle,
) -> Result<(), String> {
    let clamped = level.clamp(0.0, 1.0);
    {
        let mut player = state.write().await;
        player.volume = clamped;
    }
    // Persist so the next launch restores this level. Fire-and-forget the
    // disk write — JSON is tiny and writes happen only on user-driven
    // changes (slider drags / clicks), not on every poller cycle.
    let snapshot = {
        let mut s = settings_state.write().await;
        s.general.last_volume = clamped;
        s.clone()
    };
    settings::save(&app, &snapshot);
    // Forward to YTM
    if let Some(window) = crate::webview_bridge::get_ytm_window(&app) {
        let args = format!("{{\"level\":{}}}", clamped);
        let _ = crate::webview_bridge::exec_playback_command_with_args(
            &window,
            "set_volume",
            &args,
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn seek(
    secs: f64,
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut player = state.write().await;
    player.position_secs = secs.max(0.0);
    // Forward to YTM
    if let Some(window) = crate::webview_bridge::get_ytm_window(&app) {
        let args = format!("{{\"secs\":{}}}", secs);
        let _ =
            crate::webview_bridge::exec_playback_command_with_args(&window, "seek", &args);
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_like(
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    // Optimistic flip; the bridge poller will reconcile with the real
    // YTM like-status on the next cycle.
    let is_liked = {
        let mut player = state.write().await;
        player.is_liked = !player.is_liked;
        player.is_liked
    };

    forward_to_ytm(&app, "toggle_like");

    app.emit("player:like-changed", &is_liked)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn toggle_shuffle(
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut player = state.write().await;
        player.is_shuffled = !player.is_shuffled;
    }
    forward_to_ytm(&app, "toggle_shuffle");
    Ok(())
}

#[tauri::command]
pub async fn cycle_repeat(
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut player = state.write().await;
        player.repeat_mode = match player.repeat_mode {
            RepeatMode::None => RepeatMode::All,
            RepeatMode::All => RepeatMode::One,
            RepeatMode::One => RepeatMode::None,
        };
    }
    forward_to_ytm(&app, "cycle_repeat");
    Ok(())
}

/// Legacy: kept for compatibility but now also forwards through cycle_repeat.
#[tauri::command]
pub async fn set_repeat(
    mode: RepeatMode,
    state: State<'_, SharedPlayerState>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut player = state.write().await;
        player.repeat_mode = mode;
    }
    forward_to_ytm(&app, "cycle_repeat");
    Ok(())
}

// --- YTM window management ---

/// Hide the YTM window after login
#[tauri::command]
pub async fn hide_ytm(app: AppHandle) -> Result<(), String> {
    let window = crate::webview_bridge::get_ytm_window(&app)
        .ok_or("YTM window not found")?;
    crate::webview_bridge::hide_ytm_window(&window)
}

/// Show the YTM window (for re-login or debugging)
#[tauri::command]
pub async fn show_ytm(app: AppHandle) -> Result<(), String> {
    let window = crate::webview_bridge::get_ytm_window(&app)
        .ok_or("YTM window not found")?;
    crate::webview_bridge::show_ytm_window(&window)
}

/// Inject the JS bridge into YTM window
#[tauri::command]
pub async fn inject_ytm_bridge(app: AppHandle) -> Result<(), String> {
    let window = crate::webview_bridge::get_ytm_window(&app)
        .ok_or("YTM window not found")?;
    crate::webview_bridge::inject_bridge(&window)
}
