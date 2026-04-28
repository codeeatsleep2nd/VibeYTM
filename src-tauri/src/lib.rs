mod cache;
mod commands;
// Modules below are `pub` so the `tests/` integration tests (separate
// crate) can drive real PlayerState + EventBus + settings flows
// end-to-end. The lib has no third-party consumers — only `main.rs`
// and the integration tests — so the wider visibility is safe.
pub mod events;
mod integrations;
mod logging;
mod protocols;
pub mod state;
mod tray;
// `pub` so the integration test in `tests/updater_check_once.rs` can
// reach `updater::check_once_at` against a local mock server (issue #72).
pub mod updater;
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
        // Custom URI scheme for cached images. Lets `<img src="vibeytm-
        // cache://localhost/?u=…">` resolve directly through the
        // existing disk cache, bypassing the `cache_fetch_image` IPC +
        // `convertFileSrc` round trip on every image load. The webview
        // handles concurrency natively; the frontend's hand-rolled
        // 6-slot limiter is no longer needed once consumers migrate.
        .register_asynchronous_uri_scheme_protocol(
            "vibeytm-cache",
            protocols::cache_image::handler,
        )
        // Build the macOS app menu BEFORE the event loop starts so the About
        // dialog metadata (website + comments) is wired into NSApp's standard
        // about panel from launch. Setting this from inside `setup` lands
        // after macOS has cached the default menu and the About dialog
        // ignores the override.
        .menu(|app_handle| {
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};

                // As of muda 0.17.2 (current Cargo.lock pin), the predefined
                // About item passes `credits` to NSApp's standard about
                // panel as a plain NSString — no link attribute, no
                // paragraph alignment. So clickable URLs and centered
                // text aren't reachable through that path. If muda gains
                // a richer credits field in a later version, re-evaluate
                // whether this custom webview workaround can be dropped.
                //
                // Replace the predefined About with a custom MenuItem that
                // opens a small Tauri webview window rendering inline HTML —
                // full control over typography, alignment, and clickable
                // links, and cross-platform.
                let about_item = MenuItem::with_id(
                    app_handle,
                    "show-about-window",
                    "About VibeYTM",
                    true,
                    None::<&str>,
                )?;

                let app_submenu = SubmenuBuilder::new(app_handle, "VibeYTM")
                    .item(&about_item)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(app_handle, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let window_submenu = SubmenuBuilder::new(app_handle, "Window")
                    .minimize()
                    .separator()
                    .close_window()
                    .build()?;

                MenuBuilder::new(app_handle)
                    .item(&app_submenu)
                    .item(&edit_submenu)
                    .item(&window_submenu)
                    .build()
            }
            #[cfg(not(target_os = "macos"))]
            {
                tauri::menu::Menu::default(app_handle)
            }
        })
        .on_menu_event(|app_handle, event| {
            // Custom "About VibeYTM" item — opens a small webview window
            // rendering inline HTML with the app description, version, and
            // a clickable link. Replaces the muda predefined About item
            // because that one can't render clickable URLs or centered
            // text inside NSApp's standard about panel.
            if event.id().0 == "show-about-window" {
                if let Some(existing) = app_handle.get_webview_window("about") {
                    let _ = existing.show();
                    let _ = existing.set_focus();
                    return;
                }
                // The page fetches version + tagline + website URL via Tauri
                // IPC at runtime, so the content stays synced with the in-app
                // Settings page (single source of truth: `commands::about`).
                let html = r##"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>About VibeYTM</title>
<style>
  html,body { margin:0; padding:0; height:100%; }
  body {
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
    background:#1c1c1e; color:#fff;
    display:flex; align-items:center; justify-content:center;
    text-align:center; padding:32px 28px;
    box-sizing:border-box;
    -webkit-font-smoothing:antialiased;
  }
  .stack { display:flex; flex-direction:column; align-items:center; gap:6px; }
  h1 { margin:0; font-size:22px; font-weight:600; letter-spacing:-0.01em; }
  .v       { color:rgba(255,255,255,0.55); font-size:13px; margin-bottom:14px; }
  .built   { color:rgba(255,255,255,0.7);  font-size:13px; }
  .tag     { color:rgba(255,255,255,0.55); font-size:13px; }
  .visit   { color:rgba(255,255,255,0.55); font-size:13px; }
  a        { color:#0a84ff; text-decoration:none; }
  a:hover  { text-decoration:underline; }
</style>
</head><body>
  <div class="stack">
    <h1>VibeYTM</h1>
    <div class="v" id="version">Version …</div>
    <div class="built" id="built-with">Built with Tauri + React</div>
    <div class="tag" id="tagline">A YouTube Music desktop client</div>
    <div class="visit"><span id="visit-prefix">Visit</span>
      <a href="#" id="visit-link">ytm.gleevibe.ai</a>
      <span id="visit-suffix">for more information</span>
    </div>
  </div>
  <script>
    (async () => {
      const apply = (info) => {
        document.getElementById('version').textContent = `Version ${info.version}`;
        document.getElementById('built-with').textContent = info.built_with;
        document.getElementById('tagline').textContent = info.tagline;
        document.getElementById('visit-prefix').textContent = info.visit_prefix;
        const link = document.getElementById('visit-link');
        link.textContent = info.website_label;
        link.dataset.url = info.website_url;
        document.getElementById('visit-suffix').textContent = info.visit_suffix;
      };
      // Preferred: use the data injected via WebviewWindow.initialization_script
      // — works in every webview regardless of URL scope or __TAURI__ injection.
      if (window.__VIBEYTM_ABOUT__) {
        apply(window.__VIBEYTM_ABOUT__);
      } else if (window.__TAURI__ && window.__TAURI__.core) {
        try {
          apply(await window.__TAURI__.core.invoke('get_about_info'));
        } catch (err) {
          document.getElementById('version').textContent = 'load failed: ' + err;
        }
      } else {
        document.getElementById('version').textContent = 'no about source available';
      }
      document.getElementById('visit-link').addEventListener('click', (e) => {
        e.preventDefault();
        // Trigger a top-level navigation. The Rust-side `on_navigation`
        // handler intercepts every non-file:// URL and re-routes it to
        // the system browser via the opener plugin, then blocks the
        // in-window navigation. So this never actually leaves this page.
        const url = e.currentTarget.dataset.url || 'https://ytm.gleevibe.ai';
        window.location.href = url;
      });
    })();
  </script>
</body></html>"##;
                // data: URLs over a few hundred chars commonly fail to parse
                // as a tauri Url, so write the HTML to the user-scoped app
                // cache dir and load it via file:// instead. We deliberately
                // avoid `std::env::temp_dir()` (resolves to world-writable
                // `/tmp` on macOS with a fixed filename) — anything in /tmp
                // is open to a race-write between `fs::write` and
                // `WebviewWindowBuilder` from any other process.
                let cache_dir = match app_handle.path().app_cache_dir() {
                    Ok(d) => d,
                    Err(e) => {
                        tracing::warn!(error = %e, "no app cache dir for about.html");
                        return;
                    }
                };
                if let Err(e) = std::fs::create_dir_all(&cache_dir) {
                    tracing::warn!(error = %e, "create app cache dir");
                    return;
                }
                let path = cache_dir.join("about.html");
                if let Err(e) = std::fs::write(&path, html.as_bytes()) {
                    tracing::warn!(error = %e, "failed to write about.html");
                    return;
                }
                let url_str = format!("file://{}", path.display());
                let parsed = match url_str.parse() {
                    Ok(u) => u,
                    Err(e) => {
                        tracing::warn!(error = %e, url = %url_str, "failed to parse about file:// URL");
                        return;
                    }
                };
                // Inject the about info as a global so the page can read it
                // without depending on Tauri's IPC layer being injected for
                // file:// URLs (which it isn't, in some configurations).
                let info = commands::about::get_about_info(app_handle.clone());
                let init_script = match serde_json::to_string(&info) {
                    Ok(json) => format!("window.__VIBEYTM_ABOUT__ = {json};"),
                    Err(e) => {
                        tracing::warn!(error = %e, "serializing about info");
                        String::new()
                    }
                };
                let app_for_nav = app_handle.clone();
                if let Err(e) = WebviewWindowBuilder::new(
                    app_handle,
                    "about",
                    WebviewUrl::External(parsed),
                )
                .title("About VibeYTM")
                .inner_size(380.0, 240.0)
                .resizable(false)
                .minimizable(false)
                .maximizable(false)
                .initialization_script(init_script)
                // Block any non-file:// navigation inside the about window and
                // re-route the URL to the system default browser via the
                // opener plugin. This catches link clicks, window.location
                // assignments, target="_blank" — all roads to "open this URL"
                // end up here.
                .on_navigation(move |url| {
                    let scheme = url.scheme();
                    if scheme == "file" {
                        return true;
                    }
                    use tauri_plugin_opener::OpenerExt;
                    // The return value is `false` either way (navigation
                    // blocked), but logging the failure means a missing
                    // default browser / sandbox-denied open isn't an
                    // invisible "click does nothing" experience.
                    if let Err(e) =
                        app_for_nav.opener().open_url(url.as_str(), None::<&str>)
                    {
                        tracing::warn!(
                            error = %e,
                            url = %url,
                            "about: opener failed to launch system browser"
                        );
                    }
                    false
                })
                .build()
                {
                    tracing::warn!(error = %e, "failed to build about window");
                }
            }
        })
        .on_window_event(|window, event| {
            // macOS: clicking the red close button should hide the main
            // window (leaving the app in the dock) instead of terminating
            // it, so a subsequent dock-icon click can restore it via the
            // Reopen handler below. The "Close to tray" setting gates this
            // behavior — when disabled, the red button quits the app like
            // a conventional desktop program (issue #43).
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let settings = window
                        .app_handle()
                        .try_state::<SharedSettings>()
                        .map(|s| state::settings::read_blocking(&s).general)
                        .unwrap_or(state::settings::GeneralSettings {
                            close_to_tray: true,
                            background_playback: true,
                            last_volume: 1.0,
                        });
                    // Flush the last-played session to disk right now so the
                    // next launch can restore it even when the user closes
                    // the app within the saver's 5s tick (issue #24).
                    if let Some(player_state) = window
                        .app_handle()
                        .try_state::<SharedPlayerState>()
                    {
                        state::persistence::flush_now(
                            window.app_handle(),
                            &player_state,
                        );
                    }
                    if settings.close_to_tray {
                        api.prevent_close();
                        // If the user opted out of background playback, pause
                        // the YTM webview before hiding the main window so
                        // audio doesn't keep playing in the tray (issue #47).
                        if !settings.background_playback {
                            if let Some(ytm_window) =
                                crate::webview_bridge::get_ytm_window(window.app_handle())
                            {
                                let _ = crate::webview_bridge::exec_playback_command(
                                    &ytm_window,
                                    "pause",
                                );
                            }
                        }
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
            commands::player::on_queue_changed,
            commands::get_player_state,
            commands::player::get_account_info,
            commands::player::get_login_state,
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
            commands::browse::get_library_podcasts,
            commands::browse::get_podcast_last_episode,
            commands::browse::save_playlist_to_library,
            commands::browse::remove_playlist_from_library,
            commands::browse::get_lyrics,
            commands::browse::invalidate_lyrics_cache,
            commands::browse::get_upcoming_tracks,
            commands::browse::get_audio_counterpart_artwork,
            commands::cache::cache_fetch_image,
            commands::debug::debug_log,
            commands::cache::cache_clear,
            commands::cache::cache_stats,
            commands::about::get_about_info,
            commands::cache::cache_get_track,
            commands::cache::cache_put_track,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::updater::check_for_updates,
        ])
        .setup(move |app| {
            // Load persisted settings before registering integrations so a
            // future preference that gates an integration would see it.
            let loaded_settings = state::settings::load(app.handle());
            // Restore the last-used volume into PlayerState before the
            // poller comes online — the poller's track-changed branch then
            // pushes this back into YTM whenever YTM resets `<video>.volume`
            // across navigations, so the user hears the same level they
            // last set even on a fresh launch.
            let restored_volume = loaded_settings.general.last_volume;
            {
                let settings_clone = settings_state.clone();
                let player_clone = player_state.clone();
                tauri::async_runtime::block_on(async move {
                    *settings_clone.write().await = loaded_settings;
                    player_clone.write().await.volume = restored_volume;
                });
            }

            tray::setup_tray(app.handle(), bus.clone())?;

            // Auto-update checker: hits the GitHub releases API on startup
            // and every 12h, emits `update-available` when a newer tag exists.
            updater::spawn_update_checker(
                app.handle().clone(),
                app.package_info().version.to_string(),
            );

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
            // player chrome shows where the user left off. No autoplay —
            // status stays idle until the user hits Play.
            if let Some(session) = state::persistence::load(app.handle()) {
                let state_for_restore = player_state.clone();
                tauri::async_runtime::spawn(async move {
                    state::persistence::apply(&state_for_restore, session).await;
                });
            }
            state::persistence::spawn_saver(app.handle().clone(), player_state.clone());

            // Per-episode resume: load the saved per-videoId progress
            // map and manage it so play_track can look up a previously
            // partially-listened position. spawn_saver_episode_progress
            // periodically writes new progress to disk for the
            // currently-playing episode.
            let episode_store = state::episode_progress::load(app.handle());
            let episode_state: state::episode_progress::SharedEpisodeProgress =
                Arc::new(tokio::sync::RwLock::new(episode_store));
            app.manage(episode_state.clone());
            commands::player::spawn_episode_progress_saver(
                app.handle().clone(),
                player_state.clone(),
                episode_state.clone(),
            );

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
            // Start the YTM window hidden so an already-signed-in user never
            // sees it flash on launch (issue #51). The LoginPage will call
            // show_ytm when sign-in is actually needed.
            let ytm_builder = WebviewWindowBuilder::new(app, "ytm", ytm_url)
                .title("YouTube Music")
                .inner_size(1024.0, 700.0)
                .visible(false)
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
