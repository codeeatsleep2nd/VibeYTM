use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::events::bus::EventBus;
use crate::events::types::AppEvent;
use crate::state::player::SharedPlayerState;

use super::Integration;

pub struct NotificationIntegration;

#[async_trait]
impl Integration for NotificationIntegration {
    fn name(&self) -> &'static str {
        "notifications"
    }

    async fn start(
        &self,
        bus: Arc<EventBus>,
        _state: SharedPlayerState,
        app: AppHandle,
    ) -> Result<()> {
        let mut rx = bus.subscribe();

        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(AppEvent::TrackChanged(track)) => {
                        if let Err(e) = app
                            .notification()
                            .builder()
                            .title(&track.title)
                            .body(&track.artist)
                            .show()
                        {
                            tracing::warn!(
                                error = %e,
                                "failed to show track notification"
                            );
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(skipped = n, "notification listener lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        tracing::info!("notification listener shutting down");
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    async fn stop(&self) -> Result<()> {
        Ok(())
    }
}
