use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

use crate::events::bus::EventBus;
use crate::events::types::{AppEvent, PlaybackCommand};

/// Title bar shown above the divider in the tray menu when there's no
/// active track. Replaced by "<title> — <artist>" once playback starts.
const IDLE_TITLE: &str = "VibeYTM — Not playing";
/// Cap the tray title length so a long song name doesn't push the menu
/// past sensible width on small screens.
const TRAY_TITLE_MAX_CHARS: usize = 60;

pub fn setup_tray(
    app: &AppHandle,
    bus: Arc<EventBus>,
) -> Result<(), Box<dyn std::error::Error>> {
    let title = MenuItemBuilder::new(IDLE_TITLE).enabled(false).build(app)?;
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

    let bus_clicks = bus.clone();
    TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            tracing::info!(action = id, "tray menu item clicked");

            match id {
                "play_pause" => {
                    bus_clicks.emit(AppEvent::PlaybackCommand(PlaybackCommand::TogglePlay));
                }
                "next" => {
                    bus_clicks.emit(AppEvent::PlaybackCommand(PlaybackCommand::Next));
                }
                "previous" => {
                    bus_clicks.emit(AppEvent::PlaybackCommand(PlaybackCommand::Previous));
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    // Now-playing label: subscribe to TrackChanged events and live-update
    // the tray's first menu item with "<title> — <artist>". Keeps the
    // tray menu informative when the user opens it without bringing the
    // window to the foreground (background playback case). Updates are
    // best-effort — failure to set_text just leaves the prior label.
    let title_for_updates = title.clone();
    let mut rx = bus.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if let AppEvent::TrackChanged(track) = event {
                let label = format_tray_title(&track.title, &track.artist);
                if let Err(e) = title_for_updates.set_text(&label) {
                    tracing::warn!(error = %e, "failed to update tray title");
                }
            }
        }
    });

    Ok(())
}

/// Format the tray's now-playing label. Keep small enough for any
/// menu width — long titles get an ellipsis after `TRAY_TITLE_MAX_CHARS`.
pub(crate) fn format_tray_title(title: &str, artist: &str) -> String {
    let title = title.trim();
    let artist = artist.trim();
    let raw = if !title.is_empty() && !artist.is_empty() {
        format!("{title} — {artist}")
    } else if !title.is_empty() {
        title.to_string()
    } else {
        return IDLE_TITLE.to_string();
    };
    truncate_with_ellipsis(&raw, TRAY_TITLE_MAX_CHARS)
}

fn truncate_with_ellipsis(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let cut: String = input.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_tray_title_combines_title_and_artist() {
        assert_eq!(
            format_tray_title("Little Lies", "Fleetwood Mac"),
            "Little Lies — Fleetwood Mac"
        );
    }

    #[test]
    fn format_tray_title_falls_back_to_title_only_when_artist_empty() {
        assert_eq!(format_tray_title("Untitled", ""), "Untitled");
    }

    #[test]
    fn format_tray_title_returns_idle_label_when_both_empty() {
        assert_eq!(format_tray_title("", ""), IDLE_TITLE);
    }

    #[test]
    fn format_tray_title_truncates_overlong_strings() {
        let title = "Song with an extremely long title that will overflow the tray menu";
        let artist = "Verbose Artist";
        let out = format_tray_title(title, artist);
        assert!(out.chars().count() <= TRAY_TITLE_MAX_CHARS);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn format_tray_title_trims_whitespace() {
        assert_eq!(format_tray_title("  A  ", "  B  "), "A — B");
    }
}
