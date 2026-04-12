use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

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
        let bus_play = bus.clone();
        let bus_next = bus.clone();
        let bus_prev = bus.clone();

        app.global_shortcut().on_shortcut(
            "CommandOrControl+Shift+Space",
            move |_app, _shortcut, _event| {
                bus_play.emit(AppEvent::PlaybackCommand(PlaybackCommand::TogglePlay));
            },
        )?;

        app.global_shortcut().on_shortcut(
            "CommandOrControl+Shift+Right",
            move |_app, _shortcut, _event| {
                bus_next.emit(AppEvent::PlaybackCommand(PlaybackCommand::Next));
            },
        )?;

        app.global_shortcut().on_shortcut(
            "CommandOrControl+Shift+Left",
            move |_app, _shortcut, _event| {
                bus_prev.emit(AppEvent::PlaybackCommand(PlaybackCommand::Previous));
            },
        )?;

        tracing::info!("global shortcuts registered");
        Ok(())
    }

    async fn stop(&self) -> Result<()> {
        Ok(())
    }
}
