use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

use crate::events::bus::EventBus;
use crate::events::types::{AppEvent, PlaybackCommand};

pub fn setup_tray(
    app: &AppHandle,
    bus: Arc<EventBus>,
) -> Result<(), Box<dyn std::error::Error>> {
    let title = MenuItemBuilder::new("VibeYTM").enabled(false).build(app)?;
    let play_pause = MenuItemBuilder::with_id("play_pause", "Play/Pause").build(app)?;
    let next = MenuItemBuilder::with_id("next", "Next").build(app)?;
    let previous = MenuItemBuilder::with_id("previous", "Previous").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&title)
        .separator()
        .item(&play_pause)
        .item(&next)
        .item(&previous)
        .separator()
        .item(&quit)
        .build()?;

    TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            tracing::info!(action = id, "tray menu item clicked");

            match id {
                "play_pause" => {
                    bus.emit(AppEvent::PlaybackCommand(PlaybackCommand::TogglePlay));
                }
                "next" => {
                    bus.emit(AppEvent::PlaybackCommand(PlaybackCommand::Next));
                }
                "previous" => {
                    bus.emit(AppEvent::PlaybackCommand(PlaybackCommand::Previous));
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
