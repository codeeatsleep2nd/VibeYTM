mod commands;
mod events;
mod integrations;
mod logging;
mod state;
mod tray;
mod webview_bridge;
mod ytm_api;

use std::sync::Arc;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use events::EventBus;
use state::player::SharedPlayerState;
use ytm_api::YtmApi;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init_logging();

    let bus = Arc::new(EventBus::new());
    let player_state: SharedPlayerState = SharedPlayerState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .manage(bus.clone())
        .manage(player_state.clone())
        .manage(YtmApi::new())
        .invoke_handler(tauri::generate_handler![
            commands::on_track_changed,
            commands::on_playback_status_changed,
            commands::on_position_updated,
            commands::get_player_state,
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
            commands::player::hide_ytm,
            commands::player::show_ytm,
            commands::player::inject_ytm_bridge,
            commands::browse::search,
            commands::browse::get_home,
            commands::browse::get_library_playlists,
        ])
        .setup(move |app| {
            tray::setup_tray(app.handle(), bus.clone())?;

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
        .run(tauri::generate_context!())
        .expect("error running VibeYTM");
}
