//! Executes YouTube Music internal API calls from within the YTM WebView.
//!
//! Strategy: eval JS that calls fetch() and writes result to a global variable,
//! then poll for the result with a second eval.
//! WKWebView doesn't support returning Promises from evaluateJavaScript,
//! so we use a two-phase approach: fire-and-forget the fetch, then poll for result.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::api_cache;

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

            // Prefer YTM's own INNERTUBE_CONTEXT (pulled from ytcfg) so our
            // requests match the ones YTM web makes. That's what unlocks the
            // Elements-rendered timed lyrics on synced tracks — the minimal
            // hand-crafted context we used before got the plain-text path only.
            var ytctx = null;
            try {{
                if (window.ytcfg && typeof window.ytcfg.get === 'function') {{
                    ytctx = window.ytcfg.get('INNERTUBE_CONTEXT');
                }}
                if (!ytctx && window.ytcfg && window.ytcfg.data_) {{
                    ytctx = window.ytcfg.data_.INNERTUBE_CONTEXT;
                }}
            }} catch (e) {{ ytctx = null; }}
            var ytApiKey = null;
            try {{
                if (window.ytcfg && typeof window.ytcfg.get === 'function') {{
                    ytApiKey = window.ytcfg.get('INNERTUBE_API_KEY');
                }}
                if (!ytApiKey && window.ytcfg && window.ytcfg.data_) {{
                    ytApiKey = window.ytcfg.data_.INNERTUBE_API_KEY;
                }}
            }} catch (e) {{ ytApiKey = null; }}

            makeAuth().then(function(auth) {{
                var headers = {{
                    'Content-Type': 'application/json',
                    'X-Origin': 'https://music.youtube.com',
                    'X-Goog-AuthUser': '0',
                    'X-YouTube-Client-Name': (ytctx && ytctx.client && ytctx.client.clientName === 'WEB_REMIX') ? '67' : '67',
                    'X-YouTube-Client-Version': (ytctx && ytctx.client && ytctx.client.clientVersion) || '1.20250407.01.00',
                }};
                if (auth) headers['Authorization'] = auth;
                var url = 'https://music.youtube.com/youtubei/v1/{endpoint}?prettyPrint=false';
                if (ytApiKey) url += '&key=' + encodeURIComponent(ytApiKey);
                var ctx = ytctx || {{
                    client: {{
                        clientName: 'WEB_REMIX',
                        clientVersion: '1.20250407.01.00',
                        hl: navigator.language || 'en',
                        gl: 'US'
                    }}
                }};
                return fetch(url, {{
                    method: 'POST',
                    credentials: 'include',
                    headers: headers,
                    body: JSON.stringify(Object.assign({{ context: ctx }}, {body_json}))
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
    // If the YTM window navigated mid-fetch (e.g. the post-sign-in
    // navigate_to_home transition), the original fetch is killed and the
    // global is never written. Re-fire the JS at increasing intervals so
    // the request lands once the new page is loaded enough for fetch().
    let refire_intervals = [
        std::time::Duration::from_secs(3),
        std::time::Duration::from_secs(8),
        std::time::Duration::from_secs(15),
    ];
    let mut next_refire_idx: usize = 0;

    loop {
        if start.elapsed() > timeout {
            tracing::error!(req_id, "ytm_api_call timed out");
            // Clean up any stray entry
            if let Ok(mut map) = results_map().lock() {
                map.remove(&req_id);
            }
            return Err("ytm_api_call timed out".into());
        }

        if next_refire_idx < refire_intervals.len()
            && start.elapsed() >= refire_intervals[next_refire_idx]
        {
            tracing::info!(
                req_id,
                attempt = next_refire_idx + 2,
                "ytm_api_call: re-firing fetch JS (page-nav race)"
            );
            next_refire_idx += 1;
            let app_refire = app.clone();
            let fire_js_refire = fire_js.clone();
            let _ = app.run_on_main_thread(move || {
                let Some(window) = app_refire.get_webview_window("ytm") else { return; };
                let _ = window.with_webview(move |pv| {
                    #[cfg(target_os = "macos")]
                    unsafe {
                        let wk: &objc2_web_kit::WKWebView =
                            &*(pv.inner() as *const objc2_web_kit::WKWebView);
                        let js = objc2_foundation::NSString::from_str(&fire_js_refire);
                        wk.evaluateJavaScript_completionHandler(&js, None);
                    }
                });
            });
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

/// Cached variant. On a hit, returns the previously-fetched response
/// directly without crossing the bridge — same JSON string, same
/// downstream parsers. On a miss, calls `ytm_api_call`, stores the
/// response under `ttl`, and returns it. Pass `None` for `ttl` to
/// always go through the bridge (use for live state like the queue
/// scrape that must reflect the very latest YTM DOM).
pub async fn ytm_api_call_cached(
    app: &AppHandle,
    endpoint: &str,
    body_json: &str,
    ttl: Option<Duration>,
) -> Result<String, String> {
    let Some(ttl) = ttl else {
        return ytm_api_call(app, endpoint, body_json).await;
    };
    let key = api_cache::cache_key(endpoint, body_json);
    if let Some(hit) = api_cache::get(&key).await {
        tracing::info!(endpoint, key = %&key[..16], "ytm_api_call: cache hit");
        return Ok(hit);
    }
    let response = ytm_api_call(app, endpoint, body_json).await?;
    api_cache::set(key, response.clone(), ttl).await;
    Ok(response)
}
