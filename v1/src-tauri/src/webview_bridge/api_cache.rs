//! In-process cache for `ytm_api_call` responses, keyed by
//! `SHA256(endpoint + sorted-keys body)`. Mirrors kaset's `APICache`
//! contract (per-endpoint TTL, LRU eviction at capacity, throttled
//! eviction passes).
//!
//! Each entry is the raw JSON string that the WebKit fetch returned —
//! exactly what `ytm_api_call` would emit on a miss — so callers don't
//! need to know whether a value came from cache or the bridge.
//!
//! TTLs match kaset's table:
//!   home / library    →  5 min
//!   playlist / track  → 30 min
//!   artist            →  1 h
//!   search            →  2 min
//!   lyrics            → 24 h
//!
//! Capacity is bounded at `MAX_ENTRIES`; LRU evicts when exceeded
//! (oldest by `last_accessed`). The eviction sweep itself is throttled
//! to once per 30 s so a hot home-page navigation doesn't pay the
//! sweep cost on every request.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;

const MAX_ENTRIES: usize = 50;
const EVICTION_INTERVAL: Duration = Duration::from_secs(30);

/// Per-endpoint TTLs. Pick from these instead of free-form `Duration`
/// so the cache contract stays in one place — drift across call sites
/// would silently change correctness assumptions (e.g. lyrics
/// re-fetch after a known-good match).
pub mod ttl {
    use super::Duration;
    pub const HOME: Duration = Duration::from_secs(5 * 60);
    pub const LIBRARY: Duration = Duration::from_secs(5 * 60);
    pub const PLAYLIST: Duration = Duration::from_secs(30 * 60);
    pub const SONG_METADATA: Duration = Duration::from_secs(30 * 60);
    pub const ARTIST: Duration = Duration::from_secs(60 * 60);
    pub const SEARCH: Duration = Duration::from_secs(2 * 60);
    pub const LYRICS: Duration = Duration::from_secs(24 * 60 * 60);
}

#[derive(Debug, Clone)]
struct Entry {
    body: String,
    expires_at: Instant,
    last_accessed: Instant,
}

#[derive(Default)]
struct Inner {
    entries: std::collections::HashMap<String, Entry>,
    last_eviction_at: Option<Instant>,
}

static CACHE: OnceLock<RwLock<Inner>> = OnceLock::new();

fn cache() -> &'static RwLock<Inner> {
    CACHE.get_or_init(|| RwLock::new(Inner::default()))
}

/// Compute the cache key. Mirrors kaset's `stableCacheKey` —
/// SHA256 over `endpoint|sorted-keys-body`. Sorting the body keys is
/// what makes it cache-stable: two semantically equivalent JSON
/// payloads with different key order resolve to the same key.
pub fn cache_key(endpoint: &str, body_json: &str) -> String {
    let normalized_body = sort_json_keys(body_json);
    let mut hasher = Sha256::new();
    hasher.update(endpoint.as_bytes());
    hasher.update(b"|");
    hasher.update(normalized_body.as_bytes());
    hex::encode(hasher.finalize())
}

/// Re-emit the JSON with all object keys sorted (recursively). Falls
/// back to the input verbatim if parsing fails — caller will then
/// observe a key collision only when the source was genuinely
/// duplicate, not when key order differed.
fn sort_json_keys(json: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(json) else {
        return json.to_string();
    };
    serde_json::to_string(&sort_value(value)).unwrap_or_else(|_| json.to_string())
}

fn sort_value(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            let mut out = serde_json::Map::with_capacity(entries.len());
            for (k, v) in entries {
                out.insert(k, sort_value(v));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(sort_value).collect()),
        other => other,
    }
}

/// Look up a cached body. Touches `last_accessed` on hit so LRU
/// eviction keeps recently-used entries.
pub async fn get(key: &str) -> Option<String> {
    let now = Instant::now();
    // Try a read first — common path.
    {
        let inner = cache().read().await;
        let entry = inner.entries.get(key)?;
        if now > entry.expires_at {
            // Expired — fall through to a write so we can drop it.
        } else {
            // Touch via a separate write below.
            let body = entry.body.clone();
            drop(inner);
            let mut inner = cache().write().await;
            if let Some(e) = inner.entries.get_mut(key) {
                e.last_accessed = now;
            }
            return Some(body);
        }
    }
    // Expired path — clear it.
    let mut inner = cache().write().await;
    if let Some(e) = inner.entries.get(key) {
        if now > e.expires_at {
            inner.entries.remove(key);
        }
    }
    None
}

/// Insert a fresh body. Triggers a throttled eviction sweep first to
/// bound the map size; if still at capacity after sweeping, evicts
/// the least-recently-used entry to make room.
pub async fn set(key: String, body: String, ttl: Duration) {
    let now = Instant::now();
    let mut inner = cache().write().await;

    // Throttled expired-entry sweep — at most every EVICTION_INTERVAL.
    let should_sweep = inner
        .last_eviction_at
        .map(|t| now.duration_since(t) > EVICTION_INTERVAL)
        .unwrap_or(true);
    if should_sweep {
        evict_expired(&mut inner.entries, now);
        inner.last_eviction_at = Some(now);
    }

    // LRU eviction if still at capacity.
    while inner.entries.len() >= MAX_ENTRIES {
        evict_least_recently_used(&mut inner.entries);
    }

    inner.entries.insert(
        key,
        Entry {
            body,
            expires_at: now + ttl,
            last_accessed: now,
        },
    );
}

/// Drop every cached entry. Called by `cache_clear` IPC so the
/// settings "Clear cache" button purges API responses too.
pub async fn clear_all() {
    let mut inner = cache().write().await;
    inner.entries.clear();
    inner.last_eviction_at = None;
}

/// Drop entries whose key starts with `prefix`. Used by save / like /
/// refresh actions to invalidate the affected library/playlist
/// without nuking the whole cache.
///
/// Note: keys are SHA256 hashes; the public IPC equivalent calls
/// `clear_all` because callers can't compute prefixes. This is here
/// for any future targeted invalidation hook.
pub async fn invalidate_with<F: Fn(&str) -> bool>(predicate: F) {
    let mut inner = cache().write().await;
    inner.entries.retain(|k, _| !predicate(k));
}

fn evict_expired(map: &mut std::collections::HashMap<String, Entry>, now: Instant) {
    map.retain(|_, e| e.expires_at > now);
}

fn evict_least_recently_used(map: &mut std::collections::HashMap<String, Entry>) {
    // Find the oldest by last_accessed; remove it.
    let Some(oldest_key) = map
        .iter()
        .min_by_key(|(_, e)| e.last_accessed)
        .map(|(k, _)| k.clone())
    else {
        return;
    };
    map.remove(&oldest_key);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_deterministic_for_same_inputs() {
        let a = cache_key("browse", r#"{"browseId":"FEmusic_home"}"#);
        let b = cache_key("browse", r#"{"browseId":"FEmusic_home"}"#);
        assert_eq!(a, b);
    }

    #[test]
    fn cache_key_is_stable_across_key_order() {
        // Same semantics, different JSON key order — must collide.
        let a = cache_key("browse", r#"{"browseId":"X","params":"Y"}"#);
        let b = cache_key("browse", r#"{"params":"Y","browseId":"X"}"#);
        assert_eq!(a, b);
    }

    #[test]
    fn cache_key_differs_for_different_endpoints() {
        let a = cache_key("browse", r#"{"x":1}"#);
        let b = cache_key("search", r#"{"x":1}"#);
        assert_ne!(a, b);
    }

    #[test]
    fn cache_key_differs_for_different_bodies() {
        let a = cache_key("browse", r#"{"x":1}"#);
        let b = cache_key("browse", r#"{"x":2}"#);
        assert_ne!(a, b);
    }

    #[test]
    fn sort_json_keys_recurses_into_nested_objects() {
        let raw = r#"{"b":{"y":2,"x":1},"a":1}"#;
        let sorted = sort_json_keys(raw);
        assert_eq!(sorted, r#"{"a":1,"b":{"x":1,"y":2}}"#);
    }

    #[test]
    fn sort_json_keys_passes_through_when_not_json() {
        assert_eq!(sort_json_keys("not json {{"), "not json {{");
    }

    // Async tests use a one-shot tokio runtime since we don't have a
    // shared #[tokio::test] harness in this module.
    #[test]
    fn set_and_get_roundtrip() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Use a unique key so we don't collide with other tests
            // that run in the same binary against the global CACHE.
            let key = cache_key("test_endpoint_roundtrip", r#"{"a":1}"#);
            set(key.clone(), "hello".into(), Duration::from_secs(60)).await;
            assert_eq!(get(&key).await.as_deref(), Some("hello"));
        });
    }

    #[test]
    fn get_returns_none_when_missing() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            assert_eq!(get("nonexistent_key_xyz").await, None);
        });
    }

    #[test]
    fn get_returns_none_when_expired() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let key = cache_key("test_endpoint_expired", r#"{"a":1}"#);
            // 1 ms TTL → guaranteed-expired by the time we read.
            set(key.clone(), "stale".into(), Duration::from_millis(1)).await;
            tokio::time::sleep(Duration::from_millis(10)).await;
            assert_eq!(get(&key).await, None);
        });
    }

    #[test]
    fn invalidate_with_drops_matching_entries() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let k1 = cache_key("test_inv_a", r#"{}"#);
            let k2 = cache_key("test_inv_b", r#"{}"#);
            set(k1.clone(), "1".into(), Duration::from_secs(60)).await;
            set(k2.clone(), "2".into(), Duration::from_secs(60)).await;
            invalidate_with(|k| k == k1).await;
            assert_eq!(get(&k1).await, None);
            assert_eq!(get(&k2).await.as_deref(), Some("2"));
        });
    }
}
