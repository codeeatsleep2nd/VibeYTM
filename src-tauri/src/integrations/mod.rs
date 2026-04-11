pub mod global_shortcuts;
pub mod notifications;

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tauri::AppHandle;

use crate::events::bus::EventBus;
use crate::state::player::SharedPlayerState;

#[async_trait]
pub trait Integration: Send + Sync {
    fn name(&self) -> &'static str;

    async fn start(
        &self,
        bus: Arc<EventBus>,
        state: SharedPlayerState,
        app: AppHandle,
    ) -> Result<()>;

    async fn stop(&self) -> Result<()>;
}

/// Register all available integrations.
pub fn register_integrations() -> Vec<Box<dyn Integration>> {
    vec![
        Box::new(notifications::NotificationIntegration),
        Box::new(global_shortcuts::GlobalShortcutsIntegration),
    ]
}
