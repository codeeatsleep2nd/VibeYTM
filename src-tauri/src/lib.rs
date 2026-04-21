mod cache;
mod commands;
mod events;
mod integrations;
mod logging;
mod state;
mod tray;
mod webview_bridge;
mod ytm_api;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use cache::Cache;
use events::EventBus;
use state::player::SharedPlayerState;
use state::settings::SharedSettings;
use ytm_api::YtmApi;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init_logging();

    let bus = Arc::new(EventBus::new());
    let player_state: SharedPlayerState = SharedPlayerState::default();
    // Settings are loaded lazily on setup (we need an AppHandle to find the
    // data dir), so initialize the shared wrapper with defaults here.
    let settings_state: SharedSettings =
        std::sync::Arc::new(tokio::sync::RwLock::new(Default::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| {
            // macOS: clicking the red close button should hide the main
            // window (leaving the app in the dock) instead of terminating
            // it, so a subsequent dock-icon click can restore it via the
            // Reopen handler below. The "Close to tray" setting gates this
            // behavior — when disabled, the red button quits the app like
            // a conventional desktop program (issue #43).
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let close_to_tray = window
                        .app_handle()
                        .try_state::<SharedSettings>()
                        .map(|s| state::settings::read_blocking(&s).general.close_to_tray)
                        .unwrap_or(true);
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        // Let the event proceed; Tauri will close the window,
                        // and since it's the last visible window the app
                        // exits on macOS/Win/Linux alike.
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .manage(bus.clone())
        .manage(player_state.clone())
        .manage(settings_state.clone())
        .manage(YtmApi::new())
        .invoke_handler(tauri::generate_handler![
            commands::on_track_changed,
            commands::on_playback_status_changed,
            commands::on_position_updated,
            commands::get_player_state,
            commands::player::get_account_info,
            commands::player::play,
            commands::player::pause,
            commands::player::toggle_play,
            commands::player::next_track,
            commands::player::previous_track,
            commands::player::add_to_queue,
            commands::player::remove_from_queue,
            commands::player::clear_queue,
            commands::player::reorder_queue,
            commands::player::play_track,
            commands::player::set_volume,
            commands::player::seek,
            commands::player::toggle_like,
            commands::player::toggle_shuffle,
            commands::player::set_repeat,
            commands::player::cycle_repeat,
            commands::player::hide_ytm,
            commands::player::show_ytm,
            commands::player::inject_ytm_bridge,
            commands::browse::search,
            commands::browse::search_suggestions,
            commands::browse::get_home,
            commands::browse::get_explore,
            commands::browse::get_playlist,
            commands::browse::get_library_playlists,
            commands::browse::get_library_songs,
            commands::browse::get_library_albums,
            commands::browse::get_library_artists,
            commands::cache::cache_fetch_image,
            commands::cache::cache_clear,
            commands::cache::cache_stats,
            commands::cache::cache_get_track,
            commands::cache::cache_put_track,
            commands::settings::get_settings,
            commands::settings::set_settings,
        ])
        .setup(move |app| {
            // Load persisted settings before registering integrations so a
            // future preference that gates an integration would see it.
            let loaded_settings = state::settings::load(app.handle());
            {
                let settings_clone = settings_state.clone();
                tauri::async_runtime::block_on(async move {
                    *settings_clone.write().await = loaded_settings;
                });
            }

            tray::setup_tray(app.handle(), bus.clone())?;

            // Initialize disk cache at {app_data}/cache
            let cache_root = app
                .path()
                .app_data_dir()
                .map(|p| p.join("cache"))
                .unwrap_or_else(|_| std::env::temp_dir().join("vibeytm-cache"));
            let cache = Cache::new(cache_root.clone()).map_err(|e| {
                tracing::error!(error = %e, "failed to init cache");
                e
            })?;
            app.manage(cache);

            // Restore last session (track + position + volume) so the
            // bottom player shows where the user left off. No autoplay —
            // status stays idle until the user hits Play.
            if let Some(session) = state::persistence::load(app.handle()) {
                let state_for_restore = player_state.clone();
                tauri::async_runtime::spawn(async move {
                    state::persistence::apply(&state_for_restore, session).await;
                });
            }
            state::persistence::spawn_saver(app.handle().clone(), player_state.clone());

            let integrations = integrations::register_integrations();
            for integration in integrations {
                let bus = bus.clone();
                let state = player_state.clone();
                let handle = app.handle().clone();
                let name = integration.name();

                tauri::async_runtime::spawn(async move {
                    if let Err(e) = integration.start(bus, state, handle).await {
                        tracing::error!(
                            integration = name,
                            error = %e,
                            "failed to start integration"
                        );
                    }
                });
            }

            // Create the YTM window programmatically so we can attach a navigation handler
            let ytm_url =
                WebviewUrl::External("https://music.youtube.com".parse().unwrap());
            // Use a Safari user agent. This achieves two things:
            // 1. YouTube Music accepts Safari as a supported browser
            // 2. Google sign-in allows Safari (unlike Chrome-spoofed WebViews)
            let safari_ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";
            let ytm_builder = WebviewWindowBuilder::new(app, "ytm", ytm_url)
                .title("YouTube Music")
                .inner_size(1024.0, 700.0)
                .visible(true)
                .decorations(true)
                .center()
                .user_agent(safari_ua)
                .initialization_script(include_str!("../../scripts/inject/ytm-compat.js"))
                .initialization_script(include_str!("../../scripts/inject/ytm-player-bridge.js"))
                .on_navigation(move |url| {
                    // Allow all HTTPS navigations — this is a dedicated YTM window
                    // Restricting causes issues with Google auth redirects and YTM internal navigation
                    let scheme = url.scheme();
                    scheme == "https" || scheme == "http" || scheme == "about" || scheme == "blob"
                });

            let ytm_window = ytm_builder.build().map_err(|e| {
                tracing::error!(error = %e, "failed to create YTM window");
                e
            })?;

            // Bridge is injected via initialization_script — runs on every page load.
            // Start the poller that reads state from the bridge via document.title trick.
            webview_bridge::poller::start_poller(
                app.handle().clone(),
                player_state.clone(),
                bus.clone(),
            );

            let _ytm_window = ytm_window;

            // Forward PlaybackCommand events to YTM window
            let bus_for_commands = bus.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut rx = bus_for_commands.subscribe();
                loop {
                    match rx.recv().await {
                        Ok(events::types::AppEvent::PlaybackCommand(cmd)) => {
                            if let Some(window) = app_handle.get_webview_window("ytm") {
                                let cmd_str = match cmd {
                                    events::types::PlaybackCommand::Play => "play",
                                    events::types::PlaybackCommand::Pause => "pause",
                                    events::types::PlaybackCommand::TogglePlay => {
                                        "toggle_play"
                                    }
                                    events::types::PlaybackCommand::Next => "next",
                                    events::types::PlaybackCommand::Previous => "previous",
                                    _ => continue,
                                };
                                let _ = webview_bridge::exec_playback_command(
                                    &window, cmd_str,
                                );
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!(
                                skipped = n,
                                "playback command listener lagged"
                            );
                        }
                        Err(_) => break,
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building VibeYTM")
        .run(|app_handle, event| {
            // macOS Reopen: fired when the user clicks the dock icon while
            // the app has no visible windows. Standard expected behavior is
            // to restore the main window.
            if let RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
