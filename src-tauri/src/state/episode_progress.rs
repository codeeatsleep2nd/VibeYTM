//! Per-episode playback progress map. Persisted to
//! `{app_data}/episode_progress.json` so the user can resume any
//! podcast / show episode they previously started — including across
//! app restarts.
//!
//! Songs are intentionally NOT tracked here: YTM users expect songs
//! to start from 0 on click; resume is the long-form-audio convention
//! and the kaset reference applies it specifically to episodes. We
//! gate writes on the active playlist context (MPSP* browseId).
//!
//! Capacity is bounded at `MAX_ENTRIES`; LRU eviction happens on
//! every save when the cap is exceeded so the file stays small.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;

const PROGRESS_FILE: &str = "episode_progress.json";
const MAX_ENTRIES: usize = 100;
/// Don't bother persisting positions inside the first 5 s of an
/// episode — the user almost certainly intends a fresh start anyway,
/// and saving them clutters the LRU with throwaway entries.
const MIN_POSITION_TO_SAVE_SECS: f64 = 5.0;
/// Treat anything within the last 10 s as "finished" — start fresh
/// next time rather than dumping the user 1 s before the credits.
const NEAR_END_THRESHOLD_SECS: f64 = 10.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeProgress {
    pub video_id: String,
    pub position_secs: f64,
    pub duration_secs: f64,
    /// Wall-clock timestamp (ms since epoch) of the last update —
    /// used as the LRU key when evicting old entries.
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct EpisodeProgressStore {
    /// Keyed by videoId. Insertion order is irrelevant; eviction reads
    /// `updated_at_ms` directly.
    pub entries: HashMap<String, EpisodeProgress>,
}

pub type SharedEpisodeProgress = Arc<RwLock<EpisodeProgressStore>>;

fn progress_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(PROGRESS_FILE))
}

/// Load the per-episode map from disk. Any IO/parse failure returns
/// an empty store — persistence is best-effort.
pub fn load(app: &AppHandle) -> EpisodeProgressStore {
    let Some(path) = progress_path(app) else {
        return EpisodeProgressStore::default();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return EpisodeProgressStore::default();
    };
    serde_json::from_slice::<EpisodeProgressStore>(&bytes).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "failed to parse episode_progress.json, using empty store");
        EpisodeProgressStore::default()
    })
}

pub fn save(app: &AppHandle, store: &EpisodeProgressStore) {
    let Some(path) = progress_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_vec_pretty(store) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&path, &bytes) {
                tracing::warn!(error = %e, "failed to write episode_progress.json");
            }
        }
        Err(e) => tracing::warn!(error = %e, "failed to serialize episode_progress"),
    }
}

/// Write or update an entry. No-ops when the position is too small
/// (likely a fresh start) or near the end (likely finished).
/// LRU-evicts down to `MAX_ENTRIES` after the upsert.
pub fn upsert(
    store: &mut EpisodeProgressStore,
    video_id: &str,
    position_secs: f64,
    duration_secs: f64,
    now_ms: u64,
) {
    if video_id.is_empty() || position_secs < MIN_POSITION_TO_SAVE_SECS {
        return;
    }
    if duration_secs > 0.0 && position_secs > duration_secs - NEAR_END_THRESHOLD_SECS {
        // Finished — clear any prior entry so a re-listen starts fresh.
        store.entries.remove(video_id);
        return;
    }
    store.entries.insert(
        video_id.to_string(),
        EpisodeProgress {
            video_id: video_id.to_string(),
            position_secs,
            duration_secs,
            updated_at_ms: now_ms,
        },
    );
    evict_lru_if_needed(store);
}

/// Drop the oldest entries (by `updated_at_ms`) until the map fits
/// within `MAX_ENTRIES`.
fn evict_lru_if_needed(store: &mut EpisodeProgressStore) {
    if store.entries.len() <= MAX_ENTRIES {
        return;
    }
    let mut sorted: Vec<(String, u64)> = store
        .entries
        .iter()
        .map(|(k, v)| (k.clone(), v.updated_at_ms))
        .collect();
    sorted.sort_by_key(|(_, t)| *t);
    let drop_count = store.entries.len() - MAX_ENTRIES;
    for (k, _) in sorted.iter().take(drop_count) {
        store.entries.remove(k);
    }
}

pub fn get(store: &EpisodeProgressStore, video_id: &str) -> Option<EpisodeProgress> {
    store.entries.get(video_id).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> u64 {
        1_000_000
    }

    #[test]
    fn upsert_writes_a_new_entry() {
        let mut s = EpisodeProgressStore::default();
        upsert(&mut s, "ep1", 60.0, 600.0, now());
        let got = get(&s, "ep1").unwrap();
        assert_eq!(got.position_secs, 60.0);
        assert_eq!(got.duration_secs, 600.0);
        assert_eq!(got.updated_at_ms, now());
    }

    #[test]
    fn upsert_skips_positions_under_5_seconds() {
        let mut s = EpisodeProgressStore::default();
        upsert(&mut s, "ep1", 4.99, 600.0, now());
        assert!(get(&s, "ep1").is_none());
    }

    #[test]
    fn upsert_clears_entry_when_near_end() {
        let mut s = EpisodeProgressStore::default();
        upsert(&mut s, "ep1", 60.0, 600.0, now());
        assert!(get(&s, "ep1").is_some());
        // 596 / 600 — within the 10 s near-end threshold → drop.
        upsert(&mut s, "ep1", 596.0, 600.0, now());
        assert!(get(&s, "ep1").is_none());
    }

    #[test]
    fn upsert_skips_empty_video_id() {
        let mut s = EpisodeProgressStore::default();
        upsert(&mut s, "", 60.0, 600.0, now());
        assert_eq!(s.entries.len(), 0);
    }

    #[test]
    fn upsert_overwrites_existing_position() {
        let mut s = EpisodeProgressStore::default();
        upsert(&mut s, "ep1", 30.0, 600.0, 100);
        upsert(&mut s, "ep1", 90.0, 600.0, 200);
        let got = get(&s, "ep1").unwrap();
        assert_eq!(got.position_secs, 90.0);
        assert_eq!(got.updated_at_ms, 200);
    }

    #[test]
    fn lru_eviction_drops_oldest_when_over_capacity() {
        let mut s = EpisodeProgressStore::default();
        // Fill past MAX_ENTRIES with monotonically-increasing timestamps.
        for i in 0..(MAX_ENTRIES + 5) {
            upsert(&mut s, &format!("ep{i}"), 60.0, 600.0, i as u64);
        }
        assert_eq!(s.entries.len(), MAX_ENTRIES);
        // Oldest 5 should be gone.
        for i in 0..5 {
            assert!(get(&s, &format!("ep{i}")).is_none(), "ep{i} should be evicted");
        }
        for i in 5..(MAX_ENTRIES + 5) {
            assert!(get(&s, &format!("ep{i}")).is_some(), "ep{i} should remain");
        }
    }

    #[test]
    fn lru_eviction_respects_recent_updates() {
        let mut s = EpisodeProgressStore::default();
        for i in 0..MAX_ENTRIES {
            upsert(&mut s, &format!("ep{i}"), 60.0, 600.0, i as u64);
        }
        // Touch ep0 — it becomes the most recent.
        upsert(&mut s, "ep0", 70.0, 600.0, 9999);
        // Add a fresh entry that pushes us over capacity. Eviction
        // should drop ep1 (now the oldest), not ep0.
        upsert(&mut s, "fresh", 60.0, 600.0, 10000);
        assert!(get(&s, "ep0").is_some(), "recently-touched ep0 must survive");
        assert!(get(&s, "ep1").is_none(), "ep1 was the oldest after ep0's touch");
    }

    #[test]
    fn store_round_trips_via_json() {
        let mut s = EpisodeProgressStore::default();
        upsert(&mut s, "ep1", 60.0, 600.0, 100);
        upsert(&mut s, "ep2", 120.0, 1800.0, 200);
        let bytes = serde_json::to_vec(&s).unwrap();
        let parsed: EpisodeProgressStore = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed, s);
    }

    #[test]
    fn json_uses_camel_case_keys() {
        let mut s = EpisodeProgressStore::default();
        upsert(&mut s, "ep1", 60.0, 600.0, 100);
        let v = serde_json::to_value(&s).unwrap();
        let entry = &v["entries"]["ep1"];
        assert!(entry["videoId"].is_string());
        assert!(entry["positionSecs"].is_number());
        assert!(entry["durationSecs"].is_number());
        assert!(entry["updatedAtMs"].is_number());
    }
}
