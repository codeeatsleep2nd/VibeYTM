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
    AboutInfo {
        version: app.package_info().version.to_string(),
        tagline: TAGLINE,
        built_with: BUILT_WITH,
        visit_prefix: VISIT_PREFIX,
        visit_suffix: VISIT_SUFFIX,
        website_url: WEBSITE_URL,
        website_label: WEBSITE_LABEL,
    }
}
