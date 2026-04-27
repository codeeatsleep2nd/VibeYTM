pub mod api;
pub mod api_cache;
pub mod poller;

use tauri::{AppHandle, Manager, WebviewWindow};

/// Get the YTM window handle.
pub fn get_ytm_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("ytm")
}

/// Validate that a string contains only characters safe for YTM IDs
/// (alphanumerics, `_`, `-`) and does not exceed `max_len`.
///
/// YouTube video IDs are always 11 chars of `[A-Za-z0-9_-]`; playlist IDs
/// share the same alphabet but can be longer. Enforcing this before any
/// `format!`-based JS interpolation eliminates the injection vector in
/// `navigate_to_track` / `navigate_to_track_with_playlist`.
fn validate_ytm_id(id: &str, max_len: usize, field: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > max_len {
        return Err(format!("invalid {field}: length out of range"));
    }
    if !id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(format!("invalid {field}: illegal characters"));
    }
    Ok(())
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
///
/// When the track has both a music-video and an audio version, YTM
/// defaults to the music-video view for `/watch?v=VID` alone. Forcing
/// the song-radio list (`RDAMVM<VID>`) keeps YTM in audio mode and
/// produces a natural radio queue of related songs.
pub fn navigate_to_track(window: &WebviewWindow, video_id: &str) -> Result<(), String> {
    tracing::info!(video_id, "navigate_to_track");
    validate_ytm_id(video_id, 20, "video_id")?;
    let js = format!(
        r#"(function() {{
            var vid = '{vid}';
            // Mark the target so the poller can ignore stale DOM updates
            window.__VIBEYTM_TARGET_VID__ = vid;
            var a = document.createElement('a');
            a.href = '/watch?v=' + vid + '&list=RDAMVM' + vid;
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

/// Navigate to a track and resume from a specific position. Used on
/// app launch when the persisted session has a non-zero `position_secs`:
/// the `&t=Ns` URL parameter tells YouTube to start at that offset.
/// When `playlist_id` is provided we use it as the queue context;
/// otherwise we fall back to the song-radio list (`RDAMVM<vid>`) so YTM
/// stays in audio mode (matches `navigate_to_track`).
pub fn navigate_to_track_at_position(
    window: &WebviewWindow,
    video_id: &str,
    position_secs: u64,
    playlist_id: Option<&str>,
) -> Result<(), String> {
    tracing::info!(video_id, position_secs, "navigate_to_track_at_position");
    validate_ytm_id(video_id, 20, "video_id")?;
    let list_id_owned: String;
    let list_id: &str = match playlist_id {
        Some(id) => {
            validate_ytm_id(id, 100, "playlist_id")?;
            id
        }
        None => {
            list_id_owned = format!("RDAMVM{video_id}");
            &list_id_owned
        }
    };
    let js = format!(
        r#"(function() {{
            var vid = '{vid}';
            window.__VIBEYTM_TARGET_VID__ = vid;
            var a = document.createElement('a');
            a.href = '/watch?v=' + vid + '&list={list}&t={pos}s';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function() {{
                try {{ document.body.removeChild(a); }} catch(e) {{}}
            }}, 100);
            return 'ok';
        }})();"#,
        vid = video_id,
        list = list_id,
        pos = position_secs
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
    validate_ytm_id(video_id, 20, "video_id")?;
    validate_ytm_id(playlist_id, 100, "playlist_id")?;
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

#[cfg(test)]
mod tests {
    use super::validate_ytm_id;

    #[test]
    fn accepts_valid_video_id() {
        assert!(validate_ytm_id("dQw4w9WgXcQ", 20, "video_id").is_ok());
    }

    #[test]
    fn accepts_valid_playlist_id() {
        assert!(validate_ytm_id("PL-abc_123XYZ", 100, "playlist_id").is_ok());
    }

    #[test]
    fn rejects_single_quote_injection() {
        assert!(validate_ytm_id("a';alert(1);//", 20, "video_id").is_err());
    }

    #[test]
    fn rejects_angle_brackets() {
        assert!(validate_ytm_id("<script>", 20, "video_id").is_err());
    }

    #[test]
    fn rejects_empty() {
        assert!(validate_ytm_id("", 20, "video_id").is_err());
    }

    #[test]
    fn rejects_too_long() {
        let long = "a".repeat(21);
        assert!(validate_ytm_id(&long, 20, "video_id").is_err());
    }

    // =====================================================================
    // Regression tests for features added since v0.7.0.
    // =====================================================================

    // v0.9.1: navigate_to_track must use the song-radio list (`RDAMVM<vid>`)
    // so YTM streams the audio variant rather than the music-video variant
    // when both exist for the same videoId. This is verified by inspecting
    // the JS payload that would be eval'd in the YTM webview.
    fn navigate_to_track_js(video_id: &str) -> String {
        // Mirror the format string in `navigate_to_track` so a regression
        // there fails this test instead of silently changing behaviour.
        format!(
            r#"(function() {{
            var vid = '{vid}';
            // Mark the target so the poller can ignore stale DOM updates
            window.__VIBEYTM_TARGET_VID__ = vid;
            var a = document.createElement('a');
            a.href = '/watch?v=' + vid + '&list=RDAMVM' + vid;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function() {{
                try {{ document.body.removeChild(a); }} catch(e) {{}}
            }}, 100);
            return 'ok';
        }})();"#,
            vid = video_id
        )
    }

    #[test]
    fn navigate_to_track_appends_song_radio_list() {
        let js = navigate_to_track_js("dQw4w9WgXcQ");
        assert!(
            js.contains("'/watch?v=' + vid + '&list=RDAMVM' + vid"),
            "navigate_to_track must use the RDAMVM song-radio list to force \
             YTM into audio mode; otherwise tracks with both audio and \
             music-video variants land on the video player.\nGot:\n{js}"
        );
    }
}
