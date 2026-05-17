//! In-memory LRU above the on-disk image cache. Repeat hits within
//! the same session skip the file read entirely — significant on
//! pages like Home / Library where the same covers re-render every
//! navigation.
//!
//! Capacity bounded by both `MAX_ENTRIES` (count) and `MAX_BYTES`
//! (total cached payload size). LRU eviction by access timestamp;
//! eviction is O(n) but n ≤ 200 so this is negligible.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::RwLock;

const MAX_ENTRIES: usize = 200;
/// 50 MB total cached payload. Album covers run 20-80 KB each at
/// the lh3.googleusercontent.com sizes YTM serves, so 50 MB holds
/// roughly the entire active working set without crowding the rest
/// of the process memory.
const MAX_BYTES: usize = 50 * 1024 * 1024;

/// Monotonic counter feeds the LRU "last access" stamp without
/// requiring a wall clock.
static ACCESS_TICK: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone)]
struct Entry {
    bytes: Vec<u8>,
    /// Sniffed content type; cached so a repeat hit doesn't re-sniff.
    content_type: &'static str,
    last_access: u64,
}

#[derive(Default)]
struct Inner {
    entries: HashMap<String, Entry>,
    total_bytes: usize,
}

static CACHE: OnceLock<RwLock<Inner>> = OnceLock::new();

fn cache() -> &'static RwLock<Inner> {
    CACHE.get_or_init(|| RwLock::new(Inner::default()))
}

fn next_tick() -> u64 {
    ACCESS_TICK.fetch_add(1, Ordering::Relaxed)
}

/// Look up cached bytes by remote URL. On a hit, returns
/// `(bytes, content_type)` and bumps the entry's recency stamp.
pub async fn get(url: &str) -> Option<(Vec<u8>, &'static str)> {
    let mut inner = cache().write().await;
    let entry = inner.entries.get_mut(url)?;
    entry.last_access = next_tick();
    Some((entry.bytes.clone(), entry.content_type))
}

/// Insert bytes for a URL. LRU-evicts if either the entry count or
/// the total byte budget is exceeded.
pub async fn set(url: String, bytes: Vec<u8>, content_type: &'static str) {
    let len = bytes.len();
    // Don't bother caching unreasonably large payloads — they would
    // immediately evict everything else and the disk read is cheap
    // compared to the bytes-copy overhead.
    if len > MAX_BYTES / 4 {
        return;
    }
    let mut inner = cache().write().await;

    // Replace existing entry if present (correct byte accounting).
    if let Some(prev) = inner.entries.remove(&url) {
        inner.total_bytes = inner.total_bytes.saturating_sub(prev.bytes.len());
    }

    inner.total_bytes += len;
    inner.entries.insert(
        url,
        Entry {
            bytes,
            content_type,
            last_access: next_tick(),
        },
    );

    // Evict LRU until both budgets are satisfied.
    while inner.entries.len() > MAX_ENTRIES || inner.total_bytes > MAX_BYTES {
        if !evict_one(&mut inner) {
            break;
        }
    }
}

fn evict_one(inner: &mut Inner) -> bool {
    let Some(oldest_key) = inner
        .entries
        .iter()
        .min_by_key(|(_, e)| e.last_access)
        .map(|(k, _)| k.clone())
    else {
        return false;
    };
    if let Some(removed) = inner.entries.remove(&oldest_key) {
        inner.total_bytes = inner.total_bytes.saturating_sub(removed.bytes.len());
    }
    true
}

/// Wipe every entry. Wired into the user-facing "Clear cache"
/// settings action so memory-resident copies don't outlive the disk
/// versions.
pub async fn clear_all() {
    let mut inner = cache().write().await;
    inner.entries.clear();
    inner.total_bytes = 0;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // The cache is a process-wide singleton; tests must run serially
    // so one test's eviction burst doesn't evict another test's
    // entries. A static Mutex is the simplest way to enforce that
    // without adding a serial-test crate.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Runtime::new().unwrap()
    }

    #[test]
    fn set_and_get_roundtrip() {
        // unwrap_or_else handles a poisoned mutex: if a prior test
        // panicked while holding this lock, we still want subsequent
        // tests to acquire it cleanly rather than cascade-fail.
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        rt().block_on(async {
            clear_all().await;
            set("https://test/imageA".into(), vec![1, 2, 3], "image/jpeg").await;
            let (bytes, ct) = get("https://test/imageA").await.unwrap();
            assert_eq!(bytes, vec![1, 2, 3]);
            assert_eq!(ct, "image/jpeg");
        });
    }

    #[test]
    fn get_returns_none_when_missing() {
        // unwrap_or_else handles a poisoned mutex: if a prior test
        // panicked while holding this lock, we still want subsequent
        // tests to acquire it cleanly rather than cascade-fail.
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        rt().block_on(async {
            clear_all().await;
            assert!(get("https://test/missing-xyz").await.is_none());
        });
    }

    #[test]
    fn set_replaces_existing_entry_and_updates_byte_total() {
        // unwrap_or_else handles a poisoned mutex: if a prior test
        // panicked while holding this lock, we still want subsequent
        // tests to acquire it cleanly rather than cascade-fail.
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        rt().block_on(async {
            clear_all().await;
            set("https://test/dup".into(), vec![0; 1000], "image/png").await;
            set("https://test/dup".into(), vec![0; 200], "image/jpeg").await;
            let (bytes, ct) = get("https://test/dup").await.unwrap();
            assert_eq!(bytes.len(), 200);
            assert_eq!(ct, "image/jpeg");
            // Byte total reflects the latest payload size, not the sum.
            let inner = cache().read().await;
            assert_eq!(inner.total_bytes, 200);
        });
    }

    #[test]
    fn clear_all_drops_everything() {
        // unwrap_or_else handles a poisoned mutex: if a prior test
        // panicked while holding this lock, we still want subsequent
        // tests to acquire it cleanly rather than cascade-fail.
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        rt().block_on(async {
            set("https://test/clrA".into(), vec![1; 64], "image/png").await;
            set("https://test/clrB".into(), vec![2; 64], "image/png").await;
            clear_all().await;
            assert!(get("https://test/clrA").await.is_none());
            assert!(get("https://test/clrB").await.is_none());
        });
    }

    #[test]
    fn entries_over_count_capacity_evict_lru() {
        // unwrap_or_else handles a poisoned mutex: if a prior test
        // panicked while holding this lock, we still want subsequent
        // tests to acquire it cleanly rather than cascade-fail.
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        rt().block_on(async {
            clear_all().await;
            // Insert MAX_ENTRIES + 5 small payloads (under the byte
            // budget). The 5 oldest must get evicted.
            for i in 0..(MAX_ENTRIES + 5) {
                set(format!("k{i}"), vec![0; 32], "image/png").await;
            }
            let inner = cache().read().await;
            assert_eq!(inner.entries.len(), MAX_ENTRIES);
            // First 5 keys should be gone.
            for i in 0..5 {
                assert!(!inner.entries.contains_key(&format!("k{i}")));
            }
        });
    }

    #[test]
    fn refusing_oversized_payloads() {
        // unwrap_or_else handles a poisoned mutex: if a prior test
        // panicked while holding this lock, we still want subsequent
        // tests to acquire it cleanly rather than cascade-fail.
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        rt().block_on(async {
            clear_all().await;
            // > MAX_BYTES / 4 → refused (would otherwise wipe most
            // of the cache for one entry).
            let huge = vec![0u8; (MAX_BYTES / 4) + 1];
            set("https://test/huge".into(), huge, "image/png").await;
            assert!(get("https://test/huge").await.is_none());
        });
    }

    #[test]
    fn get_bumps_recency() {
        // unwrap_or_else handles a poisoned mutex: if a prior test
        // panicked while holding this lock, we still want subsequent
        // tests to acquire it cleanly rather than cascade-fail.
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        rt().block_on(async {
            clear_all().await;
            set("first".into(), vec![1], "image/png").await;
            set("second".into(), vec![2], "image/png").await;
            // Touch "first" so it becomes more recent than "second".
            let _ = get("first").await;
            // Insert (MAX_ENTRIES - 1) fillers so we end at MAX_ENTRIES + 1
            // total → exactly one eviction, which must be the oldest
            // entry ("second") rather than "first" (recency-bumped).
            for i in 0..(MAX_ENTRIES - 1) {
                set(format!("filler{i}"), vec![0; 8], "image/png").await;
            }
            assert!(get("first").await.is_some(), "recency-bumped entry must survive");
            assert!(get("second").await.is_none(), "oldest entry must be evicted");
        });
    }
}
