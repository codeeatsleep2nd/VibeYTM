//! `vibeytm-cache://` URI scheme handler.
//!
//! Request shape:
//!   `vibeytm-cache://localhost/?u=<percent-encoded remote URL>`
//!
//! The handler reuses the existing `Cache::get_or_fetch_image` so the
//! same disk cache + LRU + TTL apply as before — only the JS↔Rust IPC
//! step is dropped. The webview's native `<img>` loader fetches the
//! response with built-in concurrency control and progressive decode,
//! and there's no `convertFileSrc` translation step on the JS side.
//!
//! On a cache hit, the handler is a single open + read + respond,
//! roughly equivalent to a same-origin file fetch. On a cache miss it
//! fetches the remote URL via `reqwest` (same path the IPC took), then
//! responds.

use tauri::http::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeContext, UriSchemeResponder};

use crate::cache::Cache;

/// Sniff a content-type from the first few bytes of an image. The
/// webview's `<img>` will sniff regardless, but setting it explicitly
/// keeps DevTools / future audit tooling honest.
fn sniff_content_type(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return "image/jpeg";
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return "image/png";
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return "image/gif";
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "image/webp";
    }
    if bytes.starts_with(&[0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p'])
        || bytes.starts_with(&[0x00, 0x00, 0x00, 0x20, b'f', b't', b'y', b'p'])
    {
        return "image/avif";
    }
    "application/octet-stream"
}

/// Extract the `?u=…` query parameter — the percent-encoded remote URL
/// the webview wants to render. Returns `None` for missing/blank.
pub(crate) fn extract_remote_url(request_uri: &str) -> Option<String> {
    let query = request_uri.split('?').nth(1)?;
    for pair in query.split('&') {
        if let Some(value) = pair.strip_prefix("u=") {
            // Lazy decode that mirrors `decodeURIComponent`. Tauri's
            // request URL preserves the encoded form so we don't have
            // to handle the rest of URL-form (`+` for space, etc.).
            let decoded = percent_decode(value);
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
    }
    None
}

/// Minimal `decodeURIComponent` — handles `%XX` escapes and leaves
/// everything else verbatim. Avoids pulling `urlencoding` for one
/// caller. Bad escapes degrade to literal `%XX` text rather than
/// erroring out so a malformed URL still produces a 404 (cleaner UX
/// than a 500).
pub(crate) fn percent_decode(input: &str) -> String {
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn empty_404() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(CONTENT_LENGTH, 0)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn bad_request() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .header(CONTENT_LENGTH, 0)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn ok_image(bytes: Vec<u8>) -> Response<Vec<u8>> {
    let mime = sniff_content_type(&bytes);
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, mime)
        .header(CONTENT_LENGTH, bytes.len())
        // Webview can hold the same response in memory across re-renders
        // — and since the underlying cache is content-addressed by URL,
        // the same `vibeytm-cache://?u=…` always resolves to the same
        // bytes. A long max-age is safe.
        .header(CACHE_CONTROL, "public, max-age=86400, immutable")
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// The Tauri builder hook. Registered once at app start; serves every
/// `vibeytm-cache://` request from the cache.
pub fn handler(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app: AppHandle = ctx.app_handle().clone();
    let uri = request.uri().to_string();

    tauri::async_runtime::spawn(async move {
        let Some(remote_url) = extract_remote_url(&uri) else {
            responder.respond(bad_request());
            return;
        };

        let Some(cache) = app.try_state::<Cache>() else {
            // Cache hasn't been managed yet (race with setup). Treat
            // as a miss — the webview will retry naturally.
            responder.respond(empty_404());
            return;
        };

        match cache.get_or_fetch_image(&remote_url).await {
            Ok(path) => match std::fs::read(&path) {
                Ok(bytes) => responder.respond(ok_image(bytes)),
                Err(e) => {
                    tracing::warn!(
                        url = %remote_url,
                        path = %path.display(),
                        error = %e,
                        "vibeytm-cache: read failed"
                    );
                    responder.respond(empty_404());
                }
            },
            Err(e) => {
                tracing::warn!(
                    url = %remote_url,
                    error = %e,
                    "vibeytm-cache: fetch failed"
                );
                responder.respond(empty_404());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_remote_url_decodes_percent_encoded() {
        let uri = "vibeytm-cache://localhost/?u=https%3A%2F%2Flh3.googleusercontent.com%2Fabc%3Dw512";
        assert_eq!(
            extract_remote_url(uri),
            Some("https://lh3.googleusercontent.com/abc=w512".to_string()),
        );
    }

    #[test]
    fn extract_remote_url_returns_none_for_missing_param() {
        assert_eq!(extract_remote_url("vibeytm-cache://localhost/"), None);
        assert_eq!(extract_remote_url("vibeytm-cache://localhost/?other=x"), None);
    }

    #[test]
    fn extract_remote_url_returns_none_for_blank_param() {
        assert_eq!(extract_remote_url("vibeytm-cache://localhost/?u="), None);
    }

    #[test]
    fn extract_remote_url_first_param_wins_when_duplicated() {
        // Defensive: a URL like `?u=A&u=B` should not fail; first match wins.
        let uri = "vibeytm-cache://localhost/?u=https%3A%2F%2Fa&u=https%3A%2F%2Fb";
        assert_eq!(
            extract_remote_url(uri),
            Some("https://a".to_string()),
        );
    }

    #[test]
    fn percent_decode_handles_special_chars() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("a%3D%3F"), "a=?");
    }

    #[test]
    fn percent_decode_passes_unescaped_bytes_through() {
        assert_eq!(percent_decode("plain"), "plain");
    }

    #[test]
    fn percent_decode_keeps_malformed_escape_literal() {
        // `%ZZ` is invalid hex — preserve as-is so the URL becomes
        // un-cacheable rather than corrupted.
        assert_eq!(percent_decode("a%ZZb"), "a%ZZb");
    }

    #[test]
    fn sniff_content_type_recognizes_jpeg() {
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        assert_eq!(sniff_content_type(&jpeg), "image/jpeg");
    }

    #[test]
    fn sniff_content_type_recognizes_png() {
        let png = b"\x89PNG\r\n\x1a\nblob";
        assert_eq!(sniff_content_type(png), "image/png");
    }

    #[test]
    fn sniff_content_type_recognizes_webp() {
        let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
        webp.extend_from_slice(b"VP8L");
        assert_eq!(sniff_content_type(&webp), "image/webp");
    }

    #[test]
    fn sniff_content_type_falls_back_to_octet_stream() {
        assert_eq!(sniff_content_type(&[0u8, 1, 2, 3]), "application/octet-stream");
    }
}
