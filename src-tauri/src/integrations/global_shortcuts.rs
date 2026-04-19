use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::events::bus::EventBus;
use crate::events::types::{AppEvent, PlaybackCommand};
use crate::state::player::SharedPlayerState;

use super::Integration;

pub struct GlobalShortcutsIntegration;

#[async_trait]
impl Integration for GlobalShortcutsIntegration {
    fn name(&self) -> &'static str {
        "global_shortcuts"
    }

    async fn start(
        &self,
        bus: Arc<EventBus>,
        _state: SharedPlayerState,
        app: AppHandle,
    ) -> Result<()> {
        // Chord choices:
        // - Play/pause: Cmd+Shift+Space (safe globally on macOS/Windows/Linux)
        // - Next: Cmd+Alt+Right (avoids Ctrl+Right → macOS Mission Control spaces)
        // - Prev: Cmd+Alt+Left  (avoids Ctrl+Left  → macOS Mission Control spaces)
        // Some system-reserved chords silently fail to register on macOS, so
        // log the outcome per-shortcut instead of aborting the whole set.
        let register = |chord: &str, cmd: PlaybackCommand, bus: Arc<EventBus>| {
            let res = app
                .global_shortcut()
                .on_shortcut(chord, move |_app, _shortcut, event| {
                    // Fires on both Pressed and Released — without this guard
                    // toggle_play ran twice per keypress and users saw
                    // pause-then-play in one keystroke.
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    bus.emit(AppEvent::PlaybackCommand(cmd));
                });
            match res {
                Ok(_) => tracing::info!(chord, ?cmd, "global shortcut registered"),
                Err(e) => tracing::warn!(chord, ?cmd, error = %e, "failed to register shortcut"),
            }
        };

        register(
            "CommandOrControl+Shift+Space",
            PlaybackCommand::TogglePlay,
            bus.clone(),
        );
        register(
            "CommandOrControl+Alt+Right",
            PlaybackCommand::Next,
            bus.clone(),
        );
        register(
            "CommandOrControl+Alt+Left",
            PlaybackCommand::Previous,
            bus.clone(),
        );

        Ok(())
    }

    async fn stop(&self) -> Result<()> {
        Ok(())
    }
}
