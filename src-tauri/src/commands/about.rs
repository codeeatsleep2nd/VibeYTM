//! Single source of truth for the "About VibeYTM" content.
//!
//! Both the in-app Settings page and the standalone macOS About webview
//! window read these strings via the `get_about_info` IPC command, so any
//! copy change lands in both places at once.

use serde::Serialize;
use tauri::AppHandle;

/// One-line tagline (also rendered as the small subtitle line).
pub const TAGLINE: &str = "A YouTube Music desktop client";

/// Build-stack credit line.
pub const BUILT_WITH: &str = "Built with Tauri + React";

/// Visit-website prompt lead-in text (left of the link).
pub const VISIT_PREFIX: &str = "Visit";

/// Visit-website prompt trailing text (right of the link).
pub const VISIT_SUFFIX: &str = "for more information";

/// Public website URL.
pub const WEBSITE_URL: &str = "https://ytm.gleevibe.ai";

/// Display label for the website URL.
pub const WEBSITE_LABEL: &str = "ytm.gleevibe.ai";

#[derive(Debug, Serialize)]
pub struct AboutInfo {
    pub version: String,
    pub tagline: &'static str,
    pub built_with: &'static str,
    pub visit_prefix: &'static str,
    pub visit_suffix: &'static str,
    pub website_url: &'static str,
    pub website_label: &'static str,
}

#[tauri::command]
pub fn get_about_info(app: AppHandle) -> AboutInfo {
    // Pull the version from Tauri's runtime metadata (sourced from
    // tauri.conf.json). Reading `env!("CARGO_PKG_VERSION")` here would
    // diverge from `app.package_info().version` whenever Cargo.toml and
    // tauri.conf.json drift, which is exactly what made the in-app About
    // and the macOS system About panel show different versions.
    build_info(app.package_info().version.to_string())
}

/// Construct an `AboutInfo` for a given `version` string. Split out so the
/// constants + struct shape can be unit-tested without an `AppHandle`.
fn build_info(version: String) -> AboutInfo {
    AboutInfo {
        version,
        tagline: TAGLINE,
        built_with: BUILT_WITH,
        visit_prefix: VISIT_PREFIX,
        visit_suffix: VISIT_SUFFIX,
        website_url: WEBSITE_URL,
        website_label: WEBSITE_LABEL,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_are_non_empty() {
        // Both the in-app Settings page and the macOS About webview render
        // these directly. Empty strings would render an awkward UI hole, so
        // guard against an accidental copy-paste-deletion.
        for s in [
            TAGLINE,
            BUILT_WITH,
            VISIT_PREFIX,
            VISIT_SUFFIX,
            WEBSITE_URL,
            WEBSITE_LABEL,
        ] {
            assert!(!s.trim().is_empty(), "about copy must not be blank");
        }
    }

    #[test]
    fn website_url_is_https_to_avoid_mixed_content() {
        // The webview opens the URL in the system browser via the opener
        // plugin, but we still want a real HTTPS URL so QR-style copy/paste
        // works and we can't accidentally ship a broken `http://` link.
        assert!(WEBSITE_URL.starts_with("https://"));
    }

    #[test]
    fn website_label_appears_inside_url() {
        // Catches the common copy-paste mistake where the label drifts from
        // the actual URL — e.g. label="ytm.gleevibe.ai" but URL points to
        // some other host.
        assert!(
            WEBSITE_URL.contains(WEBSITE_LABEL),
            "label `{}` should be a substring of URL `{}`",
            WEBSITE_LABEL,
            WEBSITE_URL,
        );
    }

    #[test]
    fn build_info_passes_version_through() {
        let info = build_info("1.2.3".to_string());
        assert_eq!(info.version, "1.2.3");
        assert_eq!(info.tagline, TAGLINE);
        assert_eq!(info.website_url, WEBSITE_URL);
    }

    #[test]
    fn about_info_serializes_with_snake_case_keys() {
        // The TS `AboutInfo` interface in `src/lib/ipc.ts` reads
        // `built_with`, `visit_prefix`, `visit_suffix`, `website_url`,
        // `website_label`. Drift on either side breaks both the in-app
        // Settings about block and the macOS About window.
        let json = serde_json::to_string(&build_info("9.9.9".to_string())).unwrap();
        for key in [
            "version",
            "tagline",
            "built_with",
            "visit_prefix",
            "visit_suffix",
            "website_url",
            "website_label",
        ] {
            assert!(
                json.contains(&format!("\"{key}\"")),
                "expected key `{key}` in serialized AboutInfo: {json}"
            );
        }
    }
}
