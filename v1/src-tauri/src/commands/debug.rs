//! Frontend-driven debug log pipe.
//!
//! The React webview's `console` output is invisible from the dev-
//! server terminal because Tauri's WKWebView doesn't pipe it. This
//! IPC lets the frontend's `debug.log()` helper forward messages
//! into Rust's `tracing` so they show up alongside the rest of the
//! backend log — useful when the React UI crashes hard (e.g. blank
//! screen) and we can't reach WebView devtools.
//!
//! The frontend gates calls behind a runtime toggle (default off),
//! so this command does no work in production-style sessions.

#[tauri::command]
pub fn debug_log(level: String, message: String) {
    match level.as_str() {
        "error" => tracing::error!(target: "vibeytm::frontend", "{message}"),
        "warn" => tracing::warn!(target: "vibeytm::frontend", "{message}"),
        _ => tracing::info!(target: "vibeytm::frontend", "{message}"),
    }
}
