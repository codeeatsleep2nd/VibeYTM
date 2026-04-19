//! Polls the YTM WebView using WKWebView's evaluateJavaScript with callback.
//! Does NOT block the main thread — uses a static slot for the callback result
//! and reads it on the polling thread.

use std::sync::Arc;
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;

use crate::events::bus::EventBus;
use crate::events::types::AppEvent;
use crate::state::player::{PlaybackStatus, RepeatMode, SharedPlayerState, TrackInfo};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeState {
    #[serde(default)]
    status: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    artist: String,
    #[serde(default)]
    album: String,
    #[serde(default)]
    artwork_url: String,
    #[serde(default)]
    video_id: String,
    #[serde(default)]
    position_secs: f64,
    #[serde(default)]
    duration_secs: f64,
    #[serde(default)]
    volume: f64,
    #[serde(default)]
    is_shuffled: bool,
    #[serde(default)]
    repeat_mode: String,
    #[serde(default)]
    is_liked: bool,
    /// Only present once the sign-in state is determined. Tri-state:
    /// Some(true) = signed in, Some(false) = signed out, None = unknown.
    #[serde(default)]
    logged_in: Option<bool>,
    /// True when the bridge had only the login bit to report (no player DOM
    /// yet). We skip track/position processing in that case.
    #[serde(default)]
    login_only: bool,
    #[serde(default)]
    account: Option<BridgeAccount>,
    #[serde(default)]
    debug: Vec<String>,
}

#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BridgeAccount {
    #[serde(default)]
    name: String,
    #[serde(default)]
    avatar_url: String,
}

fn parse_repeat(s: &str) -> RepeatMode {
    match s {
        "all" => RepeatMode::All,
        "one" => RepeatMode::One,
        _ => RepeatMode::None,
    }
}

const READ_STATE_JS: &str = r#"
(function(){
  var s = window.__VIBEYTM_STATE__;
  var li = window.__VIBEYTM_LOGGED_IN__;
  var acc = window.__VIBEYTM_ACCOUNT__ || null;
  var dbg = (window.__VIBEYTM_DEBUG__ || []).slice(-20);
  // loggedIn / account are tracked even when the player DOM is absent
  // (e.g. during the Google sign-in redirect), so always wrap them through.
  if (s) { return JSON.stringify(Object.assign({}, s, { loggedIn: li, account: acc, debug: dbg })); }
  if (li === true || li === false) { return JSON.stringify({ loginOnly: true, loggedIn: li, account: acc, debug: dbg }); }
  return "null";
})();
"#;

/// Static slot for the poller's evaluateJavaScript callback result.
/// The callback writes here (on main thread), the polling thread reads it.
static POLLER_RESULT: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn get_poller_result() -> &'static Mutex<Option<String>> {
    POLLER_RESULT.get_or_init(|| Mutex::new(None))
}

pub fn start_poller(app: AppHandle, player_state: SharedPlayerState, bus: Arc<EventBus>) {
    let last_video_id = Arc::new(TokioMutex::new(String::new()));
    let last_status = Arc::new(TokioMutex::new(String::new()));
    let last_logged_in = Arc::new(TokioMutex::new(Option::<bool>::None));
    let last_account = Arc::new(TokioMutex::new(Option::<BridgeAccount>::None));
    #[cfg(debug_assertions)]
    let last_debug_len = Arc::new(TokioMutex::new(0usize));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Polling thread: schedules eval on main thread, reads result from static
    let app_clone = app.clone();
    std::thread::spawn(move || {
        loop {
            // 150ms keeps perceived latency under 300ms for play/pause without
            // significant CPU cost. Reads also happen one cycle after the eval
            // is scheduled, so the effective lag is ~2 * sleep.
            std::thread::sleep(std::time::Duration::from_millis(150));

            // Read result from PREVIOUS cycle's callback
            if let Ok(mut guard) = get_poller_result().lock() {
                if let Some(s) = guard.take() {
                    let _ = tx.send(s);
                }
            }

            // Schedule next eval on main thread (non-blocking)
            let app2 = app_clone.clone();
            let _ = app_clone.run_on_main_thread(move || {
                let Some(window) = app2.get_webview_window("ytm") else {
                    return;
                };
                let _ = window.with_webview(move |platform_wv| {
                    #[cfg(target_os = "macos")]
                    unsafe {
                        let wk: &objc2_web_kit::WKWebView =
                            &*(platform_wv.inner() as *const objc2_web_kit::WKWebView);
                        let js = objc2_foundation::NSString::from_str(READ_STATE_JS);

                        let block = block2::RcBlock::new(
                            |result: *mut objc2::runtime::AnyObject,
                             _error: *mut objc2_foundation::NSError| {
                                if result.is_null() {
                                    return;
                                }
                                let desc: *mut objc2_foundation::NSString =
                                    objc2::msg_send![result, description];
                                if !desc.is_null() {
                                    let s = (*desc).to_string();
                                    if let Ok(mut guard) = get_poller_result().lock() {
                                        *guard = Some(s);
                                    }
                                }
                            },
                        );

                        wk.evaluateJavaScript_completionHandler(&js, Some(&block));
                    }
                });
            });
        }
    });

    // Async task processes results from the polling thread
    tauri::async_runtime::spawn(async move {
        tracing::info!("bridge poller started");

        while let Some(raw) = rx.recv().await {
            let json_str = raw.trim();
            if json_str.is_empty() || json_str == "null" || json_str == "<null>" {
                continue;
            }

            let bs: BridgeState = match serde_json::from_str(json_str) {
                Ok(s) => s,
                Err(_) => continue,
            };

            // Surface bridge-side debug lines to the Rust log. Gated behind
            // debug_assertions so release builds don't write diagnostic
            // strings (which can occasionally include account-adjacent data)
            // to on-disk log files.
            #[cfg(debug_assertions)]
            if !bs.debug.is_empty() {
                let mut seen = last_debug_len.lock().await;
                let new_lines = if bs.debug.len() > *seen {
                    bs.debug[*seen..].to_vec()
                } else if bs.debug.len() < *seen {
                    bs.debug.clone()
                } else {
                    Vec::new()
                };
                *seen = bs.debug.len();
                drop(seen);
                for line in new_lines {
                    tracing::info!(bridge = %line, "bridge debug");
                }
            }
            #[cfg(not(debug_assertions))]
            let _ = &bs.debug;

            // Login-state emission is always attempted, even on the login-only
            // frame, because that frame is the whole point of the check (player
            // DOM doesn't exist yet on the sign-in page).
            if let Some(cur) = bs.logged_in {
                let mut last_li = last_logged_in.lock().await;
                if *last_li != Some(cur) {
                    *last_li = Some(cur);
                    drop(last_li);
                    let _ = app.emit("player:login-changed", &cur);
                }
            }

            // Account info: diff and emit on change. Kept alongside the
            // login-state check so the sidebar can render the avatar even
            // before any track has played.
            if let Some(ref acc) = bs.account {
                let mut last_acc = last_account.lock().await;
                if last_acc.as_ref() != Some(acc) {
                    *last_acc = Some(acc.clone());
                    drop(last_acc);
                    // Log metadata only — never the account name itself,
                    // which ends up on disk in production log files.
                    tracing::info!(
                        has_name = !acc.name.is_empty(),
                        has_avatar = !acc.avatar_url.is_empty(),
                        "account info updated"
                    );
                    let payload = serde_json::json!({
                        "name": acc.name,
                        "avatarUrl": acc.avatar_url,
                    });
                    let _ = app.emit("player:account-changed", &payload);
                    let mut ps = player_state.write().await;
                    ps.account = Some(crate::state::player::AccountInfo {
                        name: acc.name.clone(),
                        avatar_url: acc.avatar_url.clone(),
                    });
                }
            }

            // Login-only frames carry no track data — skip the rest.
            if bs.login_only || bs.title.is_empty() {
                continue;
            }

            let status = match bs.status.as_str() {
                "playing" => PlaybackStatus::Playing,
                "paused" => PlaybackStatus::Paused,
                "buffering" => PlaybackStatus::Buffering,
                _ => PlaybackStatus::Idle,
            };

            let track_key = if !bs.video_id.is_empty() {
                bs.video_id.clone()
            } else {
                format!("{}:{}", bs.title, bs.artist)
            };

            let mut last_vid = last_video_id.lock().await;
            let track_changed = track_key != *last_vid;
            if track_changed {
                *last_vid = track_key;
                drop(last_vid);

                let track = TrackInfo {
                    video_id: bs.video_id.clone(),
                    title: bs.title.clone(),
                    artist: bs.artist.clone(),
                    artist_id: None,
                    album: bs.album.clone(),
                    album_id: None,
                    artwork_url: if bs.artwork_url.is_empty() { None } else { Some(bs.artwork_url.clone()) },
                    duration_secs: bs.duration_secs,
                };

                // Persist duration in the side-cache so future list responses
                // can backfill it even when YTM doesn't return the length.
                if let Some(cache) = app.try_state::<crate::cache::Cache>() {
                    if track.duration_secs > 0.0 && !track.video_id.is_empty() {
                        cache.put_track_duration(&track.video_id, track.duration_secs);
                    }
                }

                {
                    let mut ps = player_state.write().await;
                    ps.track = Some(track.clone());
                    ps.status = status;
                }
                bus.emit(AppEvent::TrackChanged(track.clone()));
                let _ = app.emit("player:track-changed", &track);
                let _ = app.emit("player:status-changed", &status);
            } else {
                drop(last_vid);

                // Same track, but duration may have just become available
                // (YTM occasionally reports 0 for the first few cycles while
                // the <video> element buffers). Re-emit so the progress bar
                // doesn't pin at the end.
                if bs.duration_secs > 0.0 {
                    let needs_update = {
                        let ps = player_state.read().await;
                        ps.track
                            .as_ref()
                            .map(|t| t.duration_secs <= 0.0)
                            .unwrap_or(false)
                    };
                    if needs_update {
                        let updated = {
                            let mut ps = player_state.write().await;
                            if let Some(ref mut t) = ps.track {
                                t.duration_secs = bs.duration_secs;
                                Some(t.clone())
                            } else {
                                None
                            }
                        };
                        if let Some(track) = updated {
                            if let Some(cache) = app.try_state::<crate::cache::Cache>() {
                                if !track.video_id.is_empty() {
                                    cache.put_track_duration(&track.video_id, track.duration_secs);
                                }
                            }
                            let _ = app.emit("player:track-changed", &track);
                        }
                    }
                }
            }

            let mut last_st = last_status.lock().await;
            if bs.status != *last_st {
                *last_st = bs.status.clone();
                drop(last_st);
                {
                    let mut ps = player_state.write().await;
                    ps.status = status;
                }
                bus.emit(AppEvent::PlaybackStatusChanged(status));
                let _ = app.emit("player:status-changed", &status);
            } else {
                drop(last_st);
            }

            let new_repeat = parse_repeat(&bs.repeat_mode);
            let (prev_shuffled, prev_repeat, prev_liked, stored_volume) = {
                let ps = player_state.read().await;
                (ps.is_shuffled, ps.repeat_mode, ps.is_liked, ps.volume)
            };

            // YTM occasionally resets volume across track transitions (the
            // <video> element loses attribute state when the src changes).
            // On the cycle that reports a new track, refuse to overwrite our
            // stored volume and push it back to YTM instead. Outside of that
            // window we accept bs.volume as truth so tweaks made directly in
            // the YTM UI are still reflected.
            let effective_volume = if track_changed
                && (bs.volume - stored_volume).abs() > 0.01
            {
                if let Some(window) = crate::webview_bridge::get_ytm_window(&app) {
                    let args = format!("{{\"level\":{}}}", stored_volume);
                    let _ = crate::webview_bridge::exec_playback_command_with_args(
                        &window,
                        "set_volume",
                        &args,
                    );
                }
                stored_volume
            } else {
                bs.volume
            };

            {
                let mut ps = player_state.write().await;
                ps.position_secs = bs.position_secs;
                ps.volume = effective_volume;
                ps.is_shuffled = bs.is_shuffled;
                ps.repeat_mode = new_repeat;
                ps.is_liked = bs.is_liked;
            }
            let _ = app.emit("player:position", &bs.position_secs);
            let _ = app.emit("player:volume", &effective_volume);
            if prev_shuffled != bs.is_shuffled {
                let _ = app.emit("player:shuffle-changed", &bs.is_shuffled);
            }
            if prev_repeat != new_repeat {
                let _ = app.emit("player:repeat-changed", &new_repeat);
            }
            if prev_liked != bs.is_liked {
                let _ = app.emit("player:like-changed", &bs.is_liked);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_state_parses_account_camel_case() {
        // The JS side serializes with `avatarUrl` (camelCase). Rust must
        // accept that shape via the struct-level rename_all.
        let json = r#"{
            "title": "Song",
            "videoId": "abc12345678",
            "loggedIn": true,
            "account": { "name": "Jane", "avatarUrl": "https://x/a.jpg" }
        }"#;
        let bs: BridgeState = serde_json::from_str(json).unwrap();
        let acc = bs.account.expect("account should be present");
        assert_eq!(acc.name, "Jane");
        assert_eq!(acc.avatar_url, "https://x/a.jpg");
    }

    #[test]
    fn bridge_state_parses_without_account() {
        // Login-only frame: no account yet. Must still deserialize cleanly.
        let json = r#"{"loginOnly": true, "loggedIn": false}"#;
        let bs: BridgeState = serde_json::from_str(json).unwrap();
        assert!(bs.account.is_none());
        assert!(bs.login_only);
        assert_eq!(bs.logged_in, Some(false));
    }

    #[test]
    fn bridge_account_missing_fields_default_to_empty() {
        let json = r#"{"account": {}}"#;
        let bs: BridgeState = serde_json::from_str(json).unwrap();
        let acc = bs.account.unwrap();
        assert_eq!(acc.name, "");
        assert_eq!(acc.avatar_url, "");
    }

    #[test]
    fn bridge_account_equality_drives_change_detection() {
        // Poller compares last_account to current to decide whether to emit.
        let a = BridgeAccount { name: "A".into(), avatar_url: "u".into() };
        let b = BridgeAccount { name: "A".into(), avatar_url: "u".into() };
        let c = BridgeAccount { name: "A".into(), avatar_url: "v".into() };
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn parse_repeat_handles_all_modes() {
        assert_eq!(parse_repeat("all"), RepeatMode::All);
        assert_eq!(parse_repeat("one"), RepeatMode::One);
        assert_eq!(parse_repeat("none"), RepeatMode::None);
        // Unknown/empty strings fall through to None (safe default).
        assert_eq!(parse_repeat(""), RepeatMode::None);
        assert_eq!(parse_repeat("garbage"), RepeatMode::None);
    }

    #[test]
    fn bridge_state_parses_debug_vec() {
        let json = r#"{"debug": ["one","two"]}"#;
        let bs: BridgeState = serde_json::from_str(json).unwrap();
        assert_eq!(bs.debug, vec!["one", "two"]);
    }
}
