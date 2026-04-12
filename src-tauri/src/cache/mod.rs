//! Disk cache for images and track metadata.
//!
//! Layout:
//!   {app_data}/cache/
//!     images/{sha256(url)}.bin
//!     tracks/{videoId}.json
//!
//! Images are capped at `MAX_IMAGE_CACHE_BYTES` with LRU eviction (based on
//! file mtime). Track metadata is a small JSON side-cache and is included in
//! cache stats but not heavily constrained.

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
    pub total_bytes: u64,
    pub max_bytes: u64,
}

impl Cache {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("images"))
            .with_context(|| format!("creating {}/images", root.display()))?;
        fs::create_dir_all(root.join("tracks"))
            .with_context(|| format!("creating {}/tracks", root.display()))?;
        Ok(Self {
            root,
            lock: Arc::new(Mutex::new(())),
        })
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
        for sub in ["images", "tracks"] {
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
        Ok(CacheStats {
            image_count,
            image_bytes,
            track_count,
            track_bytes,
            total_bytes: image_bytes + track_bytes,
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
