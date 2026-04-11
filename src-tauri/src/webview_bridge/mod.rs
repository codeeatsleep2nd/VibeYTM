pub mod poller;

use tauri::{AppHandle, Manager, WebviewWindow};

/// Get the YTM window handle.
pub fn get_ytm_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("ytm")
}

/// Manually inject the player bridge (for re-injection/debugging).
pub fn inject_bridge(window: &WebviewWindow) -> Result<(), String> {
    tracing::info!("manually re-injecting player bridge");
    let bridge = include_str!("../../../scripts/inject/ytm-player-bridge.js");
    window.eval(bridge).map_err(|e| e.to_string())
}

/// Hide the YTM window (used after login is complete).
pub fn hide_ytm_window(window: &WebviewWindow) -> Result<(), String> {
    tracing::info!("hiding YTM window");
    window.hide().map_err(|e| e.to_string())
}

/// Show the YTM window (used for login or debugging).
pub fn show_ytm_window(window: &WebviewWindow) -> Result<(), String> {
    tracing::info!("showing YTM window");
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Execute a playback command in the YTM window.
pub fn exec_playback_command(window: &WebviewWindow, cmd: &str) -> Result<(), String> {
    let js = format!(
        "if(window.__VIBEYTM_COMMAND__){{window.__VIBEYTM_COMMAND__('{}');}}",
        cmd
    );
    window.eval(&js).map_err(|e| e.to_string())
}

/// Execute a playback command with arguments in the YTM window.
pub fn exec_playback_command_with_args(
    window: &WebviewWindow,
    cmd: &str,
    args_json: &str,
) -> Result<(), String> {
    let js = format!(
        "if(window.__VIBEYTM_COMMAND__){{window.__VIBEYTM_COMMAND__('{}', {});}}",
        cmd, args_json
    );
    window.eval(&js).map_err(|e| e.to_string())
}

/// Navigate the YTM window to play a specific video.
pub fn navigate_to_track(window: &WebviewWindow, video_id: &str) -> Result<(), String> {
    let url = format!("https://music.youtube.com/watch?v={}", video_id);
    tracing::info!(video_id, "navigating YTM to track");
    window
        .eval(&format!("window.location.href = '{}';", url))
        .map_err(|e| e.to_string())
}
