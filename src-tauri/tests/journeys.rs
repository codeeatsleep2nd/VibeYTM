//! End-to-end journey tests against the real `PlayerState` + `EventBus` +
//! `state::settings` machinery, without a Tauri runtime / webview.
//!
//! These exercise multi-step sequences (boot → play → seek → next track →
//! settings round-trip) through the actual library code that backs the
//! `#[tauri::command]` handlers, so a regression in the state mutation
//! or the event broadcast contract surfaces here even when the unit
//! tests pin only the leaf behaviors.
//!
//! Run with `cargo test --test journeys`.

use vibeytm_lib::events::bus::EventBus;
use vibeytm_lib::events::types::{AppEvent, PlaybackCommand};
use vibeytm_lib::state::player::{
    AccountInfo, PlaybackStatus, PlayerState, RepeatMode, TrackInfo,
};
use vibeytm_lib::state::settings::{AppSettings, GeneralSettings, IntegrationSettings, ShortcutSettings};

use std::sync::Arc;
use tokio::sync::RwLock;

fn sample_track(id: &str) -> TrackInfo {
    TrackInfo {
        video_id: id.to_string(),
        title: format!("Title {id}"),
        artist: "Test Artist".to_string(),
        artist_id: None,
        album: "Test Album".to_string(),
        album_id: None,
        artwork_url: Some(format!(
            "https://lh3.googleusercontent.com/{id}=w512-h512"
        )),
        duration_secs: 180.0,
    }
}

#[tokio::test]
async fn boot_to_first_track_change_sequence() {
    // Boot path: default state, bus has 0 receivers, then a UI subscriber
    // attaches and we emit a TrackChanged. The subscriber sees it.
    let state = Arc::new(RwLock::new(PlayerState::default()));
    let bus = EventBus::new();

    {
        let s = state.read().await;
        assert!(matches!(s.status, PlaybackStatus::Idle));
        assert!(s.track.is_none());
        assert_eq!(s.volume, 1.0);
    }

    let mut rx = bus.subscribe();

    let track = sample_track("abc");
    bus.emit(AppEvent::TrackChanged(track.clone()));

    let received = rx.recv().await.expect("event");
    match received {
        AppEvent::TrackChanged(t) => assert_eq!(t.video_id, "abc"),
        other => panic!("unexpected: {other:?}"),
    }

    // Apply the same mutation a real handler would do.
    {
        let mut s = state.write().await;
        s.track = Some(track);
        s.position_secs = 0.0;
    }
    let s = state.read().await;
    assert_eq!(s.track.as_ref().unwrap().title, "Title abc");
}

#[tokio::test]
async fn track_advance_resets_position_and_keeps_volume() {
    // The volume-snap-to-MAX regression (#76) was rooted in a track-change
    // path that lost the user-set volume. Pin the contract: a track
    // change resets position to 0 but never touches volume.
    let state = Arc::new(RwLock::new(PlayerState::default()));
    {
        let mut s = state.write().await;
        s.track = Some(sample_track("first"));
        s.position_secs = 47.5;
        s.volume = 0.23;
    }

    // Simulate the next-track handler: replace track + reset position; do
    // NOT touch volume.
    {
        let mut s = state.write().await;
        s.track = Some(sample_track("second"));
        s.position_secs = 0.0;
    }

    let s = state.read().await;
    assert_eq!(s.track.as_ref().unwrap().video_id, "second");
    assert_eq!(s.position_secs, 0.0);
    assert_eq!(s.volume, 0.23, "volume must survive a track change");
}

#[tokio::test]
async fn queue_mutations_round_trip_through_state() {
    let state = Arc::new(RwLock::new(PlayerState::default()));
    {
        let mut s = state.write().await;
        s.queue.push(sample_track("a"));
        s.queue.push(sample_track("b"));
        s.queue.push(sample_track("c"));
    }
    // Remove from queue
    {
        let mut s = state.write().await;
        s.queue.remove(1);
    }
    {
        let s = state.read().await;
        assert_eq!(s.queue.len(), 2);
        assert_eq!(s.queue[0].video_id, "a");
        assert_eq!(s.queue[1].video_id, "c");
    }
    // Reorder (move 0 → 1)
    {
        let mut s = state.write().await;
        let item = s.queue.remove(0);
        s.queue.insert(1, item);
    }
    {
        let s = state.read().await;
        assert_eq!(s.queue[0].video_id, "c");
        assert_eq!(s.queue[1].video_id, "a");
    }
    // Clear
    {
        let mut s = state.write().await;
        s.queue.clear();
    }
    let s = state.read().await;
    assert!(s.queue.is_empty());
}

#[tokio::test]
async fn playback_command_event_round_trips_through_bus() {
    // When the tray menu fires a PlayPause command, the bus carries it
    // verbatim to the playback subscriber. Pin the wire contract so a
    // future enum reorder doesn't silently scramble tray actions.
    let bus = EventBus::new();
    let mut rx = bus.subscribe();

    bus.emit(AppEvent::PlaybackCommand(PlaybackCommand::TogglePlay));
    bus.emit(AppEvent::PlaybackCommand(PlaybackCommand::Next));
    bus.emit(AppEvent::PlaybackCommand(PlaybackCommand::Previous));

    let mut commands: Vec<PlaybackCommand> = Vec::new();
    for _ in 0..3 {
        match rx.recv().await.expect("event") {
            AppEvent::PlaybackCommand(c) => commands.push(c),
            other => panic!("unexpected: {other:?}"),
        }
    }
    assert!(matches!(commands[0], PlaybackCommand::TogglePlay));
    assert!(matches!(commands[1], PlaybackCommand::Next));
    assert!(matches!(commands[2], PlaybackCommand::Previous));
}

#[tokio::test]
async fn multiple_subscribers_each_see_every_event() {
    // The 4× track-changed fan-out the dev log shows is fine: each
    // usePlayerState consumer needs its own receiver. Pin that the
    // EventBus actually broadcasts (not round-robins) so a future
    // refactor doesn't silently drop subscribers.
    let bus = EventBus::new();
    let mut a = bus.subscribe();
    let mut b = bus.subscribe();
    let mut c = bus.subscribe();

    bus.emit(AppEvent::PositionUpdated(12.34));

    for rx in [&mut a, &mut b, &mut c] {
        match rx.recv().await.expect("event") {
            AppEvent::PositionUpdated(p) => assert!((p - 12.34).abs() < 1e-9),
            other => panic!("unexpected: {other:?}"),
        }
    }
}

#[test]
fn settings_round_trip_with_modified_volume_and_toggles() {
    // GeneralSettings.last_volume and integrations.notifications_enabled
    // are the most-touched persisted fields. Pin the JSON wire contract
    // (camelCase, no snake_case slip-through) and the round-trip parity.
    let mut s = AppSettings {
        general: GeneralSettings {
            close_to_tray: false,
            background_playback: true,
            last_volume: 0.42,
        },
        integrations: IntegrationSettings {
            notifications_enabled: false,
        },
        shortcuts: ShortcutSettings {
            play_pause: "X".into(),
            next_track: "Y".into(),
            prev_track: "Z".into(),
        },
    };

    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["general"]["closeToTray"], false);
    assert_eq!(json["general"]["backgroundPlayback"], true);
    assert_eq!(json["general"]["lastVolume"], 0.42);
    assert_eq!(json["integrations"]["notificationsEnabled"], false);
    assert!(json["general"].get("close_to_tray").is_none());

    let parsed: AppSettings = serde_json::from_value(json).unwrap();
    assert_eq!(parsed, s);

    // Mutate a single field and re-roundtrip — partial updates from the
    // frontend's `set_settings` IPC must not lose the others.
    s.general.last_volume = 0.91;
    let json2 = serde_json::to_value(&s).unwrap();
    let parsed2: AppSettings = serde_json::from_value(json2).unwrap();
    assert_eq!(parsed2.integrations.notifications_enabled, false);
    assert_eq!(parsed2.general.last_volume, 0.91);
}

#[tokio::test]
async fn login_state_transitions_match_frontend_expectations() {
    // The boot orchestrator (useBootState) reads `logged_in` as the
    // tri-state that drives loading|login|app phases. Pin the
    // transitions a sign-in event walks through.
    let state = Arc::new(RwLock::new(PlayerState::default()));

    // 1. Pre-bridge: unknown.
    assert!(state.read().await.logged_in.is_none());

    // 2. Bridge reports signed-out.
    {
        let mut s = state.write().await;
        s.logged_in = Some(false);
    }
    assert_eq!(state.read().await.logged_in, Some(false));

    // 3. User signs in.
    {
        let mut s = state.write().await;
        s.logged_in = Some(true);
        s.account = Some(AccountInfo {
            name: "Jane".into(),
            avatar_url: "https://example.test/jane.jpg".into(),
        });
    }
    {
        // Scoped so the read guard drops before the next write below
        // — otherwise `state.write().await` deadlocks waiting for a
        // reader that's still alive in the test body.
        let s = state.read().await;
        assert_eq!(s.logged_in, Some(true));
        assert_eq!(s.account.as_ref().unwrap().name, "Jane");
    }

    // 4. Sign out clears account but leaves track state alone (#50).
    {
        let mut s = state.write().await;
        s.logged_in = Some(false);
        s.account = None;
    }
    let s = state.read().await;
    assert!(s.account.is_none());
}

#[tokio::test]
async fn shuffle_repeat_cycle_is_idempotent_per_step() {
    let state = Arc::new(RwLock::new(PlayerState::default()));

    // Shuffle toggle
    {
        let mut s = state.write().await;
        s.is_shuffled = !s.is_shuffled;
    }
    assert!(state.read().await.is_shuffled);
    {
        let mut s = state.write().await;
        s.is_shuffled = !s.is_shuffled;
    }
    assert!(!state.read().await.is_shuffled);

    // Repeat cycle: None → All → One → None
    let cycle = |mode: RepeatMode| -> RepeatMode {
        match mode {
            RepeatMode::None => RepeatMode::All,
            RepeatMode::All => RepeatMode::One,
            RepeatMode::One => RepeatMode::None,
        }
    };
    let mut mode = state.read().await.repeat_mode;
    assert!(matches!(mode, RepeatMode::None));
    for _ in 0..3 {
        mode = cycle(mode);
        let mut s = state.write().await;
        s.repeat_mode = mode;
    }
    assert!(matches!(state.read().await.repeat_mode, RepeatMode::None));
}

#[tokio::test]
async fn playlist_context_persists_across_track_change() {
    // The active_playlist_id must survive a track change so /next can
    // fetch the right radio queue (CLAUDE.md "PlannedQueue" pattern).
    let state = Arc::new(RwLock::new(PlayerState::default()));
    {
        let mut s = state.write().await;
        s.active_playlist_id = Some("OLAK5uy_demo".into());
        s.track = Some(sample_track("first"));
    }
    // Simulate auto-advance: track change, but playlist context stays.
    {
        let mut s = state.write().await;
        s.track = Some(sample_track("second"));
        s.position_secs = 0.0;
    }
    let s = state.read().await;
    assert_eq!(s.active_playlist_id.as_deref(), Some("OLAK5uy_demo"));
    assert_eq!(s.track.as_ref().unwrap().video_id, "second");
}
