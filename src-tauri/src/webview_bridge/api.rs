//! Executes YouTube Music internal API calls from within the YTM WebView.
//!
//! Strategy: eval JS that calls fetch() and writes result to a global variable,
//! then poll for the result with a second eval.
//! WKWebView doesn't support returning Promises from evaluateJavaScript,
//! so we use a two-phase approach: fire-and-forget the fetch, then poll for result.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager};

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);
// Per-request result slot keyed by req_id. A single global slot cannot support
// concurrent calls — two in-flight requests would stomp each other.
static API_RESULTS: OnceLock<Mutex<HashMap<u64, String>>> = OnceLock::new();

fn results_map() -> &'static Mutex<HashMap<u64, String>> {
    API_RESULTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn ytm_api_call(
    app: &AppHandle,
    endpoint: &str,
    body_json: &str,
) -> Result<String, String> {
    let req_id = REQUEST_ID.fetch_add(1, Ordering::SeqCst);

    tracing::info!(endpoint, req_id, "ytm_api_call: starting");

    // Phase 1: Fire the fetch and store result in a global variable
    // This JS does NOT return a Promise — it returns "ok" immediately
    let fire_js = format!(
        r#"
        (function() {{
            window.__VIBEYTM_API_{req_id}__ = null;
            // Generate SAPISIDHASH auth header from cookies (required for logged-in requests)
            function makeAuth() {{
                var m = document.cookie.match(/SAPISID=([^;]+)/);
                if (!m) return Promise.resolve(null);
                var sapisid = m[1];
                var ts = Math.floor(Date.now() / 1000);
                var origin = 'https://music.youtube.com';
                var input = ts + ' ' + sapisid + ' ' + origin;
                return crypto.subtle.digest('SHA-1', new TextEncoder().encode(input)).then(function(buf) {{
                    var hex = Array.from(new Uint8Array(buf)).map(function(b) {{
                        return b.toString(16).padStart(2, '0');
                    }}).join('');
                    return 'SAPISIDHASH ' + ts + '_' + hex;
                }});
            }}

            makeAuth().then(function(auth) {{
                var headers = {{
                    'Content-Type': 'application/json',
                    'X-Origin': 'https://music.youtube.com',
                    'X-Goog-AuthUser': '0',
                }};
                if (auth) headers['Authorization'] = auth;
                return fetch('https://music.youtube.com/youtubei/v1/{endpoint}?prettyPrint=false', {{
                    method: 'POST',
                    credentials: 'include',
                    headers: headers,
                    body: JSON.stringify(Object.assign({{
                        context: {{
                            client: {{
                                clientName: 'WEB_REMIX',
                                clientVersion: '1.20250407.01.00',
                                hl: navigator.language || 'en',
                                gl: 'US'
                            }}
                        }}
                    }}, {body_json}))
                }});
            }})
            .then(function(r) {{ return r.text(); }})
            .then(function(t) {{ window.__VIBEYTM_API_{req_id}__ = t; }})
            .catch(function(e) {{ window.__VIBEYTM_API_{req_id}__ = 'VIBEYTM_ERROR:' + e.message; }});
            return 'fired';
        }})();
        "#,
        endpoint = endpoint,
        body_json = body_json,
        req_id = req_id,
    );

    // Phase 2: Read the result from the global variable
    let read_js = format!(
        r#"
        (function() {{
            var r = window.__VIBEYTM_API_{req_id}__;
            if (r !== null && r !== undefined) {{
                delete window['__VIBEYTM_API_{req_id}__'];
                return r;
            }}
            return null;
        }})();
        "#,
        req_id = req_id,
    );

    // Fire phase 1 on main thread
    let app1 = app.clone();
    let fire_js_clone = fire_js.clone();
    app.run_on_main_thread(move || {
        let Some(window) = app1.get_webview_window("ytm") else { return; };
        let _ = window.with_webview(move |pv| {
            #[cfg(target_os = "macos")]
            unsafe {
                let wk: &objc2_web_kit::WKWebView =
                    &*(pv.inner() as *const objc2_web_kit::WKWebView);
                let js = objc2_foundation::NSString::from_str(&fire_js_clone);
                // Fire and forget — no need for callback result
                wk.evaluateJavaScript_completionHandler(&js, None);
            }
        });
    }).map_err(|e| format!("run_on_main_thread failed: {e}"))?;

    // Phase 2: Poll for result
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(30);

    loop {
        if start.elapsed() > timeout {
            tracing::error!(req_id, "ytm_api_call timed out");
            // Clean up any stray entry
            if let Ok(mut map) = results_map().lock() {
                map.remove(&req_id);
            }
            return Err("ytm_api_call timed out".into());
        }

        // Wait before polling
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        // Eval the read JS
        let app2 = app.clone();
        let read_js_clone = read_js.clone();
        let rid = req_id;
        let _ = app.run_on_main_thread(move || {
            let Some(window) = app2.get_webview_window("ytm") else { return; };
            let _ = window.with_webview(move |pv| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let wk: &objc2_web_kit::WKWebView =
                        &*(pv.inner() as *const objc2_web_kit::WKWebView);
                    let js = objc2_foundation::NSString::from_str(&read_js_clone);

                    let block = block2::RcBlock::new(
                        move |result: *mut objc2::runtime::AnyObject,
                              _error: *mut objc2_foundation::NSError| {
                            if result.is_null() {
                                return;
                            }
                            let desc: *mut objc2_foundation::NSString =
                                objc2::msg_send![result, description];
                            if !desc.is_null() {
                                let s = (*desc).to_string();
                                if s != "null" && s != "<null>" {
                                    if let Ok(mut map) = results_map().lock() {
                                        map.insert(rid, s);
                                    }
                                }
                            }
                        },
                    );

                    wk.evaluateJavaScript_completionHandler(&js, Some(&block));
                }
            });
        });

        // Wait for callback
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Check for this specific request's result
        let own_result = results_map()
            .lock()
            .ok()
            .and_then(|mut map| map.remove(&req_id));

        if let Some(raw) = own_result {
            tracing::info!(req_id, len = raw.len(), "ytm_api_call: got result");
            if let Some(err) = raw.strip_prefix("VIBEYTM_ERROR:") {
                return Err(format!("JS fetch error: {err}"));
            }
            // DEBUG: dump response to /tmp for analysis
            let dump_path = format!("/tmp/vibeytm-resp-{}-{}.json", endpoint, req_id);
            let _ = std::fs::write(&dump_path, &raw);
            tracing::info!(dump_path, "dumped response");
            return Ok(raw);
        }
    }
}
