pub mod api;
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

/// Play a specific video in the YTM window.
/// Uses full SPA navigation via anchor click which YTM's polymer router
/// intercepts. This is much faster than `window.location.href` (no full
/// page reload) while still updating the YTM DOM properly.
pub fn navigate_to_track(window: &WebviewWindow, video_id: &str) -> Result<(), String> {
    tracing::info!(video_id, "navigate_to_track");
    let js = format!(
        r#"(function() {{
            var vid = '{vid}';
            // Mark the target so the poller can ignore stale DOM updates
            window.__VIBEYTM_TARGET_VID__ = vid;
            var a = document.createElement('a');
            a.href = '/watch?v=' + vid;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function() {{
                try {{ document.body.removeChild(a); }} catch(e) {{}}
            }}, 100);
            return 'ok';
        }})();"#,
        vid = video_id
    );
    window.eval(&js).map_err(|e| e.to_string())
}

/// Play a track in the context of a playlist (for proper queue/next behavior).
pub fn navigate_to_track_with_playlist(
    window: &WebviewWindow,
    video_id: &str,
    playlist_id: &str,
) -> Result<(), String> {
    tracing::info!(video_id, playlist_id, "navigate_to_track_with_playlist");
    let js = format!(
        r#"(function() {{
            var vid = '{vid}';
            var list = '{list}';
            window.__VIBEYTM_TARGET_VID__ = vid;
            var a = document.createElement('a');
            a.href = '/watch?v=' + vid + '&list=' + list;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function() {{
                try {{ document.body.removeChild(a); }} catch(e) {{}}
            }}, 100);
            return 'ok';
        }})();"#,
        vid = video_id,
        list = playlist_id
    );
    window.eval(&js).map_err(|e| e.to_string())
}
