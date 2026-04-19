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
  // loggedIn is tracked even when the player DOM is absent (e.g. during
  // the Google sign-in redirect), so always wrap it through.
  if (s) { return JSON.stringify(Object.assign({}, s, { loggedIn: li })); }
  if (li === true || li === false) { return JSON.stringify({ loginOnly: true, loggedIn: li }); }
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
