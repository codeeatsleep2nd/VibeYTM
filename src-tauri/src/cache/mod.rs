//! Disk cache for images, track metadata, and lyrics.
//!
//! Layout:
//!   {app_data}/cache/
//!     images/{sha256(url)}.bin
//!     tracks/{videoId}.json
//!     lyrics/{videoId}.json
//!
//! Images are capped at `MAX_IMAGE_CACHE_BYTES` with LRU eviction (based on
//! file mtime). Track + lyrics metadata are small JSON side-caches and are
//! included in cache stats but not heavily constrained.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

pub const MAX_IMAGE_CACHE_BYTES: u64 = 1024 * 1024 * 1024; // 1 GB
pub const BASE_TTL_SECS: u64 = 7 * 24 * 60 * 60; // 7 days
pub const MAX_JITTER_SECS: u64 = 24 * 60 * 60; // up to +24h per entry

/// Compute a deterministic, per-key TTL in seconds: 7 days + 0..24h derived
/// from the key's hash. Using the hash keeps jitter stable across restarts so
/// we never flip a live entry to expired mid-session.
fn ttl_for(key_hash: &[u8]) -> u64 {
    let jitter = (u64::from(key_hash[0]) << 8 | u64::from(*key_hash.get(1).unwrap_or(&0)))
        % MAX_JITTER_SECS;
    BASE_TTL_SECS + jitter
}

#[derive(Clone)]
pub struct Cache {
    root: PathBuf,
    // Serializes writes / evictions so concurrent fetchers don't race the LRU.
    lock: Arc<Mutex<()>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CacheStats {
    pub image_count: u64,
    pub image_bytes: u64,
    pub track_count: u64,
    pub track_bytes: u64,
    pub lyric_count: u64,
    pub lyric_bytes: u64,
    pub total_bytes: u64,
    pub max_bytes: u64,
}

impl Cache {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("images"))
            .with_context(|| format!("creating {}/images", root.display()))?;
        fs::create_dir_all(root.join("tracks"))
            .with_context(|| format!("creating {}/tracks", root.display()))?;
        fs::create_dir_all(root.join("lyrics"))
            .with_context(|| format!("creating {}/lyrics", root.display()))?;
        Ok(Self {
            root,
            lock: Arc::new(Mutex::new(())),
        })
    }

    fn lyrics_path(&self, video_id: &str) -> (PathBuf, [u8; 32]) {
        let mut hasher = Sha256::new();
        hasher.update(video_id.as_bytes());
        let hash: [u8; 32] = hasher.finalize().into();
        (
            self.root.join("lyrics").join(format!("{video_id}.json")),
            hash,
        )
    }

    /// Read a cached lyrics JSON payload, or `None` if absent/expired.
    pub fn get_lyrics(&self, video_id: &str) -> Result<Option<String>> {
        let (path, hash) = self.lyrics_path(video_id);
        if !path.exists() {
            return Ok(None);
        }
        if Self::is_expired(&path, &hash) {
            let _ = fs::remove_file(&path);
            return Ok(None);
        }
        let _ = touch(&path);
        let content = fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        Ok(Some(content))
    }

    /// Persist a lyrics JSON payload. Overwrites any prior entry.
    pub fn put_lyrics(&self, video_id: &str, json: &str) -> Result<()> {
        if video_id.is_empty() {
            return Ok(());
        }
        let (path, _) = self.lyrics_path(video_id);
        fs::write(&path, json)
            .with_context(|| format!("writing {}", path.display()))?;
        Ok(())
    }

    fn image_path(&self, url: &str) -> (PathBuf, [u8; 32]) {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let hash: [u8; 32] = hasher.finalize().into();
        let hex = hex::encode(hash);
        (self.root.join("images").join(format!("{hex}.bin")), hash)
    }

    fn track_path(&self, video_id: &str) -> (PathBuf, [u8; 32]) {
        let mut hasher = Sha256::new();
        hasher.update(video_id.as_bytes());
        let hash: [u8; 32] = hasher.finalize().into();
        // videoIds are alnum + `_` + `-`, safe for filenames.
        (
            self.root.join("tracks").join(format!("{video_id}.json")),
            hash,
        )
    }

    /// Returns true if the file's mtime is older than its TTL window.
    fn is_expired(path: &Path, key_hash: &[u8]) -> bool {
        let Ok(meta) = fs::metadata(path) else {
            return true;
        };
        let Ok(mtime) = meta.modified() else {
            return false; // Unknown — treat as fresh, don't delete.
        };
        let ttl = std::time::Duration::from_secs(ttl_for(key_hash));
        match std::time::SystemTime::now().duration_since(mtime) {
            Ok(age) => age > ttl,
            Err(_) => false, // mtime in the future — treat as fresh
        }
    }

    /// Get a cached image path, fetching and storing it if not present.
    /// Returns the absolute path of the cached file.
    pub async fn get_or_fetch_image(&self, url: &str) -> Result<PathBuf> {
        let (path, hash) = self.image_path(url);
        if path.exists() {
            if Self::is_expired(&path, &hash) {
                let _ = fs::remove_file(&path);
            } else {
                // Touch mtime so this is LRU-fresh
                let _ = touch(&path);
                return Ok(path);
            }
        }

        let bytes = reqwest::get(url)
            .await
            .with_context(|| format!("fetching {url}"))?
            .error_for_status()
            .with_context(|| format!("bad status for {url}"))?
            .bytes()
            .await
            .context("reading response body")?;

        // Serialize store + eviction
        let _guard = self.lock.lock().await;
        fs::write(&path, &bytes)
            .with_context(|| format!("writing {}", path.display()))?;
        self.evict_if_needed_locked()?;
        Ok(path)
    }

    pub fn get_track(&self, video_id: &str) -> Result<Option<String>> {
        let (path, hash) = self.track_path(video_id);
        if !path.exists() {
            return Ok(None);
        }
        if Self::is_expired(&path, &hash) {
            let _ = fs::remove_file(&path);
            return Ok(None);
        }
        let _ = touch(&path);
        let content = fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        Ok(Some(content))
    }

    pub fn put_track(&self, video_id: &str, json: &str) -> Result<()> {
        let (path, _) = self.track_path(video_id);
        fs::write(&path, json)
            .with_context(|| format!("writing {}", path.display()))?;
        Ok(())
    }

    /// Fast helper used by the backend to remember the duration of a track.
    pub fn put_track_duration(&self, video_id: &str, secs: f64) {
        if video_id.is_empty() || secs <= 0.0 {
            return;
        }
        let json = format!("{{\"duration_secs\":{}}}", secs);
        let _ = self.put_track(video_id, &json);
    }

    /// Returns the cached duration (if any) for this videoId.
    pub fn get_track_duration(&self, video_id: &str) -> Option<f64> {
        let raw = self.get_track(video_id).ok().flatten()?;
        let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
        v.get("duration_secs").and_then(|n| n.as_f64())
    }

    pub async fn clear(&self) -> Result<u64> {
        let _guard = self.lock.lock().await;
        let mut freed = 0u64;
        for sub in ["images", "tracks", "lyrics"] {
            let dir = self.root.join(sub);
            if !dir.exists() {
                continue;
            }
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                let meta = entry.metadata()?;
                if meta.is_file() {
                    freed += meta.len();
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        Ok(freed)
    }

    pub fn stats(&self) -> Result<CacheStats> {
        let (image_count, image_bytes) = dir_stats(&self.root.join("images"))?;
        let (track_count, track_bytes) = dir_stats(&self.root.join("tracks"))?;
        let (lyric_count, lyric_bytes) = dir_stats(&self.root.join("lyrics"))?;
        Ok(CacheStats {
            image_count,
            image_bytes,
            track_count,
            track_bytes,
            lyric_count,
            lyric_bytes,
            total_bytes: image_bytes + track_bytes + lyric_bytes,
            max_bytes: MAX_IMAGE_CACHE_BYTES,
        })
    }

    fn evict_if_needed_locked(&self) -> Result<()> {
        let dir = self.root.join("images");
        let (_, mut bytes) = dir_stats(&dir)?;
        if bytes <= MAX_IMAGE_CACHE_BYTES {
            return Ok(());
        }

        // Collect (path, mtime, size) and sort oldest first.
        let mut files: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if meta.is_file() {
                let mtime = meta
                    .modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                files.push((entry.path(), mtime, meta.len()));
            }
        }
        files.sort_by_key(|(_, m, _)| *m);

        // Evict to 90% of the cap, so we don't re-evict on every insert.
        let target = (MAX_IMAGE_CACHE_BYTES as f64 * 0.9) as u64;
        for (path, _, size) in files {
            if bytes <= target {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                bytes = bytes.saturating_sub(size);
            }
        }

        Ok(())
    }
}

fn dir_stats(dir: &Path) -> Result<(u64, u64)> {
    if !dir.exists() {
        return Ok((0, 0));
    }
    let mut count = 0;
    let mut bytes = 0;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_file() {
            count += 1;
            bytes += meta.len();
        }
    }
    Ok((count, bytes))
}

fn touch(path: &Path) -> Result<()> {
    // Refresh the mtime so LRU treats this entry as recently-used. We open
    // for write + set_times via std::fs::FileTimes (stable since 1.75).
    let f = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .with_context(|| format!("open for touch {}", path.display()))?;
    let now = std::time::SystemTime::now();
    let times = fs::FileTimes::new().set_accessed(now).set_modified(now);
    f.set_times(times)
        .map_err(|e| anyhow!("set_times {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Build an isolated temp dir for each test. We don't pull in `tempfile`
    /// to keep dev-deps minimal — nanos + a monotonic counter is collision-free
    /// for a single test binary.
    fn test_root() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("vibeytm-cache-test-{}-{}", nanos, n));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn make_cache() -> (Cache, PathBuf) {
        let root = test_root();
        let cache = Cache::new(root.clone()).expect("cache::new");
        (cache, root)
    }

    #[test]
    fn image_path_is_deterministic_for_same_url() {
        let (cache, _root) = make_cache();
        let (p1, h1) = cache.image_path("https://i.ytimg.com/vi/abc/hq.jpg");
        let (p2, h2) = cache.image_path("https://i.ytimg.com/vi/abc/hq.jpg");
        assert_eq!(p1, p2);
        assert_eq!(h1, h2);
    }

    #[test]
    fn image_path_differs_for_different_urls() {
        let (cache, _root) = make_cache();
        let (p1, h1) = cache.image_path("https://i.ytimg.com/vi/abc/hq.jpg");
        let (p2, h2) = cache.image_path("https://i.ytimg.com/vi/xyz/hq.jpg");
        assert_ne!(p1, p2);
        assert_ne!(h1, h2);
    }

    #[test]
    fn ttl_jitter_is_within_window() {
        // Jitter must always fall in [BASE_TTL, BASE_TTL + MAX_JITTER).
        let h = [0u8; 32];
        let t = ttl_for(&h);
        assert!(t >= BASE_TTL_SECS);
        assert!(t < BASE_TTL_SECS + MAX_JITTER_SECS);

        let h2 = [0xff, 0xff];
        let t2 = ttl_for(&h2);
        assert!(t2 >= BASE_TTL_SECS);
        assert!(t2 < BASE_TTL_SECS + MAX_JITTER_SECS);
    }

    #[test]
    fn ttl_jitter_is_stable_for_same_hash() {
        // Must be deterministic so an entry doesn't flip to expired mid-run.
        let h = [0x42, 0x13, 0x37, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(ttl_for(&h), ttl_for(&h));
    }

    #[test]
    fn track_roundtrip() {
        let (cache, _root) = make_cache();
        cache.put_track("dQw4w9WgXcQ", r#"{"title":"x"}"#).unwrap();
        let got = cache.get_track("dQw4w9WgXcQ").unwrap();
        assert_eq!(got, Some(r#"{"title":"x"}"#.to_string()));
    }

    #[test]
    fn track_missing_returns_none() {
        let (cache, _root) = make_cache();
        assert_eq!(cache.get_track("nope").unwrap(), None);
    }

    #[test]
    fn put_get_track_duration_roundtrip() {
        let (cache, _root) = make_cache();
        cache.put_track_duration("abc123", 214.5);
        assert_eq!(cache.get_track_duration("abc123"), Some(214.5));
    }

    #[test]
    fn put_track_duration_rejects_empty_id_and_non_positive() {
        let (cache, _root) = make_cache();
        cache.put_track_duration("", 10.0);
        cache.put_track_duration("abc", 0.0);
        cache.put_track_duration("abc", -5.0);
        assert_eq!(cache.get_track_duration(""), None);
        assert_eq!(cache.get_track_duration("abc"), None);
    }

    #[test]
    fn stats_reflect_writes() {
        let (cache, _root) = make_cache();
        cache.put_track("a", r#"{"x":1}"#).unwrap();
        cache.put_track("b", r#"{"y":2}"#).unwrap();
        let stats = cache.stats().unwrap();
        assert_eq!(stats.track_count, 2);
        assert!(stats.track_bytes > 0);
        assert_eq!(stats.image_count, 0);
        assert_eq!(stats.max_bytes, MAX_IMAGE_CACHE_BYTES);
    }

    #[test]
    fn stats_count_lyrics_and_include_in_total() {
        // Settings page surfaces "N images, N tracks, N lyrics", and the
        // "Disk cache" total has to include lyrics so the size shown to the
        // user lines up with the on-disk footprint.
        let (cache, _root) = make_cache();
        cache.put_lyrics("vid-a", r#"{"text":"hello"}"#).unwrap();
        cache.put_lyrics("vid-b", r#"{"text":"world"}"#).unwrap();
        let stats = cache.stats().unwrap();
        assert_eq!(stats.lyric_count, 2);
        assert!(stats.lyric_bytes > 0);
        assert_eq!(
            stats.total_bytes,
            stats.image_bytes + stats.track_bytes + stats.lyric_bytes,
            "total_bytes must include lyric_bytes"
        );
    }

    #[test]
    fn stats_lyric_count_zero_after_construction() {
        let (cache, _root) = make_cache();
        let stats = cache.stats().unwrap();
        assert_eq!(stats.lyric_count, 0);
        assert_eq!(stats.lyric_bytes, 0);
    }

    #[tokio::test]
    async fn clear_removes_lyrics_too() {
        let (cache, _root) = make_cache();
        cache.put_lyrics("vid", r#"{"text":"x"}"#).unwrap();
        cache.put_track("a", r#"{}"#).unwrap();
        cache.clear().await.unwrap();
        let after = cache.stats().unwrap();
        assert_eq!(after.lyric_count, 0);
        assert_eq!(after.track_count, 0);
        assert_eq!(after.total_bytes, 0);
    }

    #[tokio::test]
    async fn clear_removes_tracks_and_returns_freed_bytes() {
        let (cache, _root) = make_cache();
        cache.put_track("a", r#"{"x":1}"#).unwrap();
        cache.put_track("b", r#"{"y":2}"#).unwrap();
        let before = cache.stats().unwrap().total_bytes;
        let freed = cache.clear().await.unwrap();
        assert_eq!(freed, before);
        let after = cache.stats().unwrap();
        assert_eq!(after.track_count, 0);
        assert_eq!(after.total_bytes, 0);
    }

    #[test]
    fn is_expired_true_for_missing_file() {
        let missing = std::env::temp_dir().join("vibeytm-definitely-missing-xyz");
        let _ = fs::remove_file(&missing);
        assert!(Cache::is_expired(&missing, &[0u8; 32]));
    }
}
