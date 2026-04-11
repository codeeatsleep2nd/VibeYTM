//! Polls the YTM WebView using WKWebView's evaluateJavaScript with callback.

use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::events::bus::EventBus;
use crate::events::types::AppEvent;
use crate::state::player::{PlaybackStatus, SharedPlayerState, TrackInfo};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeState {
    status: String,
    title: String,
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
}

const READ_STATE_JS: &str = r#"
(function(){
  var s = window.__VIBEYTM_STATE__;
  if (s) { return JSON.stringify(s); }
  return "null";
})();
"#;

pub fn start_poller(app: AppHandle, player_state: SharedPlayerState, bus: Arc<EventBus>) {
    let last_video_id = Arc::new(Mutex::new(String::new()));
    let last_status = Arc::new(Mutex::new(String::new()));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let app_clone = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(300));

            let tx = tx.clone();
            let app = app_clone.clone();
            let app2 = app.clone();

            let _ = app.run_on_main_thread(move || {
                let Some(window) = app2.get_webview_window("ytm") else {
                    return;
                };

                tracing::info!("poller: calling with_webview");
                let wv_result = window.with_webview(move |platform_wv| {
                    #[cfg(target_os = "macos")]
                    {
                        let wk_ptr = platform_wv.inner();
                        let tx = tx.clone();

                        unsafe {
                            let wk: &objc2_web_kit::WKWebView =
                                &*(wk_ptr as *const objc2_web_kit::WKWebView);
                            let js = objc2_foundation::NSString::from_str(READ_STATE_JS);

                            // Use RcBlock with no captures that writes to a static
                            use std::sync::atomic::{AtomicPtr, Ordering};
                            use std::sync::OnceLock;

                            static RESULT: OnceLock<std::sync::Mutex<Option<String>>> = OnceLock::new();
                            RESULT.get_or_init(|| std::sync::Mutex::new(None));

                            let block = block2::RcBlock::new(
                                |result: *mut objc2::runtime::AnyObject,
                                 _error: *mut objc2_foundation::NSError| {
                                    if result.is_null() {
                                        return;
                                    }
                                    let desc: *mut objc2_foundation::NSString = objc2::msg_send![
                                        result, description
                                    ];
                                    if !desc.is_null() {
                                        let s = (*desc).to_string();
                                        if let Some(lock) = RESULT.get() {
                                            if let Ok(mut guard) = lock.lock() {
                                                *guard = Some(s);
                                            }
                                        }
                                    }
                                },
                            );

                            tracing::info!("poller: calling evaluateJavaScript");
                            wk.evaluateJavaScript_completionHandler(&js, Some(&block));

                            // Wait a bit then read the result
                            std::thread::sleep(std::time::Duration::from_millis(50));
                            if let Some(lock) = RESULT.get() {
                                if let Ok(mut guard) = lock.lock() {
                                    if let Some(s) = guard.take() {
                                        tracing::info!(result = %s, "got JS result!");
                                        let _ = tx.send(s);
                                    }
                                }
                            }
                        }
                    }
                });
                match wv_result {
                    Ok(_) => tracing::info!("poller: with_webview OK"),
                    Err(e) => tracing::warn!(error = %e, "poller: with_webview failed"),
                }
            });
        }
    });

    tauri::async_runtime::spawn(async move {
        tracing::info!("bridge poller started");

        while let Some(raw) = rx.recv().await {
            let json_str = raw.trim();
            if json_str.is_empty() || json_str == "null" || json_str == "<null>" {
                continue;
            }

            let bs: BridgeState = match serde_json::from_str(json_str) {
                Ok(s) => s,
                Err(e) => {
                    tracing::debug!(error = %e, raw = %raw, "parse failed");
                    continue;
                }
            };

            if bs.title.is_empty() {
                continue;
            }

            let status = match bs.status.as_str() {
                "playing" => PlaybackStatus::Playing,
                "paused" => PlaybackStatus::Paused,
                "buffering" => PlaybackStatus::Buffering,
                _ => PlaybackStatus::Idle,
            };

            // Use videoId if available, otherwise use title as track identity
            let track_key = if !bs.video_id.is_empty() {
                bs.video_id.clone()
            } else {
                format!("{}:{}", bs.title, bs.artist)
            };

            let mut last_vid = last_video_id.lock().await;
            if track_key != *last_vid {
                *last_vid = track_key;
                drop(last_vid);

                let track = TrackInfo {
                    video_id: bs.video_id.clone(),
                    title: bs.title.clone(),
                    artist: bs.artist.clone(),
                    artist_id: None,
                    album: bs.album.clone(),
                    album_id: None,
                    artwork_url: if bs.artwork_url.is_empty() {
                        None
                    } else {
                        Some(bs.artwork_url.clone())
                    },
                    duration_secs: bs.duration_secs,
                };

                {
                    let mut ps = player_state.write().await;
                    ps.track = Some(track.clone());
                    ps.status = status;
                }
                bus.emit(AppEvent::TrackChanged(track.clone()));
                let _ = app.emit("player:track-changed", &track);
                let _ = app.emit("player:status-changed", &status);
                tracing::info!(title = %bs.title, artist = %bs.artist, "track changed");
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

            {
                let mut ps = player_state.write().await;
                ps.position_secs = bs.position_secs;
                ps.volume = bs.volume;
            }
            let _ = app.emit("player:position", &bs.position_secs);
            let _ = app.emit("player:volume", &bs.volume);
        }
    });
}
