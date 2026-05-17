//! Auto-update checker.
//!
//! On startup and every 12 hours thereafter, queries the GitHub releases API
//! for the latest published release of `codeeatsleep2nd/VibeYTM`. If the tag
//! is newer than the currently-running version, emits an `update-available`
//! Tauri event so the frontend can surface a banner. The frontend can also
//! call `check_for_updates` directly to trigger an on-demand check.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const RELEASE_API: &str =
    "https://api.github.com/repos/codeeatsleep2nd/VibeYTM/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/codeeatsleep2nd/VibeYTM/releases";
const CHECK_INTERVAL: Duration = Duration::from_secs(12 * 60 * 60);
// GitHub's REST API rejects requests without a non-empty User-Agent.
const USER_AGENT: &str = "VibeYTM-UpdateChecker";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// What the frontend receives — both via the `update-available` event and
/// the `check_for_updates` command response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
    pub release_notes: String,
    pub update_available: bool,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// Parse a version string like "v0.9.8", "0.9.8", or "1.0.0-beta.1" into a
/// vector of numeric components. Pre-release suffixes (everything from the
/// first `-` or `+` onward) are stripped before splitting on `.`, so the
/// dotted suffix in "1.0.0-beta.1" doesn't get treated as an extra component.
fn parse_version(v: &str) -> Vec<u32> {
    let trimmed = v.trim().trim_start_matches('v').trim_start_matches('V');
    let core = trimmed
        .split(|c| c == '-' || c == '+')
        .next()
        .unwrap_or(trimmed);
    core.split('.')
        .map(|part| part.parse::<u32>().unwrap_or(0))
        .collect()
}

/// Returns true when `latest` is strictly newer than `current`. Versions of
/// different lengths are zero-padded to match (so "1.0" == "1.0.0").
fn is_newer(latest: &str, current: &str) -> bool {
    let mut l = parse_version(latest);
    let mut c = parse_version(current);
    let max = l.len().max(c.len());
    l.resize(max, 0);
    c.resize(max, 0);
    l > c
}

async fn fetch_latest_release() -> Result<GitHubRelease, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("build http client: {e}"))?;

    let resp = client
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("github request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("github returned {}", resp.status()));
    }

    resp.json::<GitHubRelease>()
        .await
        .map_err(|e| format!("parse github release json: {e}"))
}

/// Run a single check against the GitHub API. Returns `Ok(UpdateInfo)` even
/// when no update exists — `update_available` will be `false`.
pub async fn check_once(current_version: &str) -> Result<UpdateInfo, String> {
    let release = fetch_latest_release().await?;

    if release.draft || release.prerelease {
        return Ok(UpdateInfo {
            current_version: current_version.to_string(),
            latest_version: release.tag_name.clone(),
            release_url: release
                .html_url
                .unwrap_or_else(|| RELEASES_PAGE.to_string()),
            release_notes: release.body.unwrap_or_default(),
            update_available: false,
        });
    }

    let latest = release.tag_name.clone();
    let update_available = is_newer(&latest, current_version);

    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: latest,
        release_url: release
            .html_url
            .unwrap_or_else(|| RELEASES_PAGE.to_string()),
        release_notes: release
            .name
            .filter(|n| !n.is_empty())
            .or(release.body)
            .unwrap_or_default(),
        update_available,
    })
}

/// Spawn the long-lived background checker. Fires once on startup and then
/// every `CHECK_INTERVAL`. Network/parse failures are logged at warn but do
/// not stop the loop — transient outages shouldn't disable update checks for
/// the rest of the session.
pub fn spawn_update_checker(app: AppHandle, current_version: String) {
    tauri::async_runtime::spawn(async move {
        // Avoid re-emitting the same `update-available` event every 12 h
        // for an unchanged release — the FE banner already filters by
        // dismissed-version, but emitting repeatedly wastes IPC traffic
        // and makes the dev-server log noisy. Reset to None when a newer
        // release supersedes the previously-emitted one (handled below by
        // the inequality check) or when the user upgrades (handled by the
        // process restart that comes with a new install).
        let mut last_emitted: Option<String> = None;
        loop {
            match check_once(&current_version).await {
                Ok(info) => {
                    if info.update_available {
                        let already_emitted = last_emitted
                            .as_deref()
                            .is_some_and(|v| v == info.latest_version);
                        if already_emitted {
                            tracing::debug!(
                                latest = %info.latest_version,
                                "update-available already emitted this session — suppressed"
                            );
                        } else {
                            tracing::info!(
                                current = %info.current_version,
                                latest = %info.latest_version,
                                "update available"
                            );
                            if let Err(e) = app.emit("update-available", &info) {
                                tracing::warn!(error = %e, "emit update-available failed");
                            } else {
                                last_emitted = Some(info.latest_version.clone());
                            }
                        }
                    } else {
                        tracing::debug!(
                            current = %info.current_version,
                            latest = %info.latest_version,
                            "no update available"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "update check failed");
                }
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_version() {
        assert_eq!(parse_version("0.9.8"), vec![0, 9, 8]);
    }

    #[test]
    fn strips_v_prefix() {
        assert_eq!(parse_version("v1.2.3"), vec![1, 2, 3]);
        assert_eq!(parse_version("V1.2.3"), vec![1, 2, 3]);
    }

    #[test]
    fn strips_prerelease_suffix() {
        assert_eq!(parse_version("1.0.0-beta.1"), vec![1, 0, 0]);
    }

    #[test]
    fn handles_garbage_components() {
        assert_eq!(parse_version("1.foo.3"), vec![1, 0, 3]);
    }

    #[test]
    fn detects_newer_patch() {
        assert!(is_newer("0.9.9", "0.9.8"));
        assert!(is_newer("v0.9.9", "0.9.8"));
    }

    #[test]
    fn detects_newer_minor_and_major() {
        assert!(is_newer("1.0.0", "0.9.99"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(is_newer("2.0.0", "1.99.99"));
    }

    #[test]
    fn rejects_same_version() {
        assert!(!is_newer("0.9.8", "0.9.8"));
        assert!(!is_newer("v0.9.8", "0.9.8"));
    }

    #[test]
    fn rejects_older_version() {
        assert!(!is_newer("0.9.7", "0.9.8"));
        assert!(!is_newer("0.9.8", "0.10.0"));
    }

    #[test]
    fn pads_short_versions() {
        // "1.0" should equal "1.0.0" — neither is newer
        assert!(!is_newer("1.0", "1.0.0"));
        assert!(!is_newer("1.0.0", "1.0"));
    }
}
