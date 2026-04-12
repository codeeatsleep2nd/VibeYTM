use tokio::sync::broadcast;

use super::types::AppEvent;

const CHANNEL_CAPACITY: usize = 256;

pub struct EventBus {
    sender: broadcast::Sender<AppEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self { sender }
    }

    pub fn emit(&self, event: AppEvent) {
        tracing::debug!(?event, "emitting event");
        // Ignore send error — it only fails when there are no receivers.
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.sender.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}
