//! Tauri commands for the disk cache.

use tauri::State;

use crate::cache::{Cache, CacheStats};

/// Hostnames permitted for remote image fetches. Anything else is rejected
/// to prevent SSRF via attacker-controlled URLs flowing through the
/// `cache_fetch_image` IPC command.
const ALLOWED_IMAGE_HOST_SUFFIXES: &[&str] = &[
    "ytimg.com",
    "youtube.com",
    "googleusercontent.com",
    "ggpht.com",
];

fn validate_image_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("image url must use https".into());
    }
    let host = parsed.host_str().ok_or("image url must have a host")?;
    let host_lower = host.to_ascii_lowercase();
    let allowed = ALLOWED_IMAGE_HOST_SUFFIXES.iter().any(|suffix| {
        host_lower == *suffix || host_lower.ends_with(&format!(".{suffix}"))
    });
    if !allowed {
        return Err(format!("image host not allowed: {host}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn cache_fetch_image(
    cache: State<'_, Cache>,
    url: String,
) -> Result<String, String> {
    validate_image_url(&url)?;
    let path = cache
        .get_or_fetch_image(&url)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::validate_image_url;

    #[test]
    fn accepts_ytimg() {
        assert!(validate_image_url("https://i.ytimg.com/vi/abc/hqdefault.jpg").is_ok());
    }

    #[test]
    fn accepts_googleusercontent() {
        assert!(validate_image_url("https://lh3.googleusercontent.com/abc=s512").is_ok());
    }

    #[test]
    fn rejects_http() {
        assert!(validate_image_url("http://i.ytimg.com/vi/abc.jpg").is_err());
    }

    #[test]
    fn rejects_unknown_host() {
        assert!(validate_image_url("https://evil.example.com/pwn.jpg").is_err());
    }

    #[test]
    fn rejects_host_suffix_trick() {
        // `evilytimg.com` must not match because of the `.` boundary check.
        assert!(validate_image_url("https://evilytimg.com/x.jpg").is_err());
    }

    #[test]
    fn rejects_file_scheme() {
        assert!(validate_image_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn rejects_garbage() {
        assert!(validate_image_url("not a url").is_err());
    }
}

#[tauri::command]
pub async fn cache_clear(cache: State<'_, Cache>) -> Result<u64, String> {
    cache.clear().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cache_stats(cache: State<'_, Cache>) -> Result<CacheStats, String> {
    cache.stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cache_get_track(
    cache: State<'_, Cache>,
    video_id: String,
) -> Result<Option<String>, String> {
    cache.get_track(&video_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cache_put_track(
    cache: State<'_, Cache>,
    video_id: String,
    json: String,
) -> Result<(), String> {
    cache.put_track(&video_id, &json).map_err(|e| e.to_string())
}
