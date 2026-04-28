//! Integration tests for `updater::check_once_at` — covers the
//! draft/prerelease suppression branch and the release-notes name/body
//! fallback that the unit tests in `updater/mod.rs` couldn't reach
//! without a real HTTP roundtrip (issue #72).

use serde_json::json;
use vibeytm_lib::updater::{check_once_at, UpdateInfo};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Build a JSON payload mimicking GitHub's "latest release" response with
/// just the fields `GitHubRelease` deserializes — the rest are ignored.
fn release_body(
    tag: &str,
    draft: bool,
    prerelease: bool,
    name: Option<&str>,
    body: Option<&str>,
    html_url: Option<&str>,
) -> serde_json::Value {
    json!({
        "tag_name": tag,
        "draft": draft,
        "prerelease": prerelease,
        "name": name,
        "body": body,
        "html_url": html_url,
    })
}

/// Stand up a mock server that returns the given JSON on `GET /releases/latest`.
async fn mock_serving(payload: serde_json::Value) -> (MockServer, String) {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/releases/latest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(payload))
        .mount(&server)
        .await;
    let url = format!("{}/releases/latest", server.uri());
    (server, url)
}

#[tokio::test]
async fn draft_release_is_suppressed() {
    let (_server, url) = mock_serving(release_body(
        "v9.9.9",
        true,  // draft
        false, // prerelease
        Some("Big Release"),
        Some("Notes"),
        Some("https://github.com/test/repo/releases/tag/v9.9.9"),
    ))
    .await;

    let info: UpdateInfo = check_once_at(&url, "0.1.0")
        .await
        .expect("check_once_at draft");
    assert!(
        !info.update_available,
        "draft release must NOT trigger update banner"
    );
    assert_eq!(info.latest_version, "v9.9.9");
}

#[tokio::test]
async fn prerelease_is_suppressed() {
    let (_server, url) = mock_serving(release_body(
        "v9.9.9-beta.1",
        false,
        true, // prerelease
        Some("Beta"),
        Some("Beta notes"),
        Some("https://github.com/test/repo/releases/tag/v9.9.9-beta.1"),
    ))
    .await;

    let info = check_once_at(&url, "0.1.0")
        .await
        .expect("check_once_at prerelease");
    assert!(
        !info.update_available,
        "prerelease must NOT trigger update banner"
    );
}

#[tokio::test]
async fn newer_stable_release_triggers_update() {
    let (_server, url) = mock_serving(release_body(
        "v9.9.9",
        false,
        false,
        Some("Big Release"),
        Some("Notes"),
        Some("https://github.com/test/repo/releases/tag/v9.9.9"),
    ))
    .await;

    let info = check_once_at(&url, "0.1.0")
        .await
        .expect("check_once_at stable newer");
    assert!(info.update_available);
    assert_eq!(info.current_version, "0.1.0");
    assert_eq!(info.latest_version, "v9.9.9");
}

#[tokio::test]
async fn release_notes_prefers_name_when_non_empty() {
    let (_server, url) = mock_serving(release_body(
        "v9.9.9",
        false,
        false,
        Some("Beta Notes"),
        Some("Long body that should NOT win"),
        Some("https://github.com/test/repo/releases/tag/v9.9.9"),
    ))
    .await;

    let info = check_once_at(&url, "0.1.0").await.unwrap();
    assert_eq!(info.release_notes, "Beta Notes");
}

#[tokio::test]
async fn release_notes_falls_back_to_body_when_name_is_empty() {
    let (_server, url) = mock_serving(release_body(
        "v9.9.9",
        false,
        false,
        Some(""), // empty name → fall back to body
        Some("Body wins"),
        Some("https://github.com/test/repo/releases/tag/v9.9.9"),
    ))
    .await;

    let info = check_once_at(&url, "0.1.0").await.unwrap();
    assert_eq!(info.release_notes, "Body wins");
}

#[tokio::test]
async fn release_notes_empty_when_both_missing() {
    let (_server, url) = mock_serving(release_body(
        "v9.9.9",
        false,
        false,
        None,
        None,
        Some("https://github.com/test/repo/releases/tag/v9.9.9"),
    ))
    .await;

    let info = check_once_at(&url, "0.1.0").await.unwrap();
    assert_eq!(info.release_notes, "");
}

#[tokio::test]
async fn release_url_falls_back_to_releases_page_when_html_url_missing() {
    let (_server, url) = mock_serving(release_body(
        "v9.9.9",
        false,
        false,
        Some("Notes"),
        None,
        None, // no html_url → fall back to RELEASES_PAGE
    ))
    .await;

    let info = check_once_at(&url, "0.1.0").await.unwrap();
    assert_eq!(
        info.release_url,
        "https://github.com/codeeatsleep2nd/VibeYTM/releases"
    );
}
