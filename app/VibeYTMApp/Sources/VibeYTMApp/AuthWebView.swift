import SwiftUI
@preconcurrency import WebKit

/// A visible WKWebView for first-time YTM sign-in. Shares
/// `WKWebsiteDataStore.default()` with the hidden audio engine, so a
/// successful login here populates the cookies the hidden engine needs.
///
/// We don't try to reuse the BridgeHost's hidden WKWebView (which would
/// require moving the view in and out of the visible window hierarchy and
/// fighting WebKit's navigation state). Two views, shared cookie store —
/// simpler and matches what Kaset / Pear Desktop do.
///
/// Auth-sync contract (fixed post-Sprint-0): this view fires
/// `onAuthenticated` the first time it navigates to a `music.youtube.com`
/// URL after the Google sign-in flow. The caller (AuthScaffold) hands a
/// closure that triggers a `BridgeHost.reload()` so the hidden WebView
/// re-evaluates the now-signed-in YTM DOM and flips
/// `__VIBEYTM_LOGGED_IN__` to true. Without this, the bridge stays
/// cached on the signed-out page forever and the app keeps showing
/// THIS very webview as the "detail pane" — which was the regression
/// captured in /tmp/vibeytm-current-state.png before this fix.
struct AuthWebView: NSViewRepresentable {
    let url: URL
    /// Fired once the WebView lands on `music.youtube.com` (= Google
    /// sign-in completed and redirected back per the `continue=`
    /// parameter, OR the user already had a valid cookie session).
    /// The closure should trigger a `BridgeHost.reload()` so the hidden
    /// WebView picks up the new cookies and flips its login flag.
    let onAuthenticated: () -> Void

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // YTM gates Premium / DRM behind a recognised desktop UA. Match
        // the bridge host's UA so the cookie set we get is the one the
        // hidden engine will use.
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
            + "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // No-op — the URL is fixed for the auth flow lifetime.
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onAuthenticated: onAuthenticated)
    }

    /// Watches navigation so we can detect the sign-in →
    /// music.youtube.com redirect and fire the auth-completed callback.
    /// Fires AT MOST ONCE per AuthWebView lifetime — a transient
    /// re-navigation back to music.youtube.com shouldn't repeatedly
    /// hammer the bridge reload.
    final class Coordinator: NSObject, WKNavigationDelegate {
        let onAuthenticated: () -> Void
        private var didFire = false

        init(onAuthenticated: @escaping () -> Void) {
            self.onAuthenticated = onAuthenticated
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !didFire else { return }
            guard let host = webView.url?.host else { return }
            // The Google sign-in `continue=https%3A%2F%2Fmusic.youtube.com`
            // parameter means a successful sign-in ends up on this host.
            // Any music.youtube.com URL counts as auth success — YTM
            // skips the sign-in prompt if a valid session cookie exists,
            // so this can also fire on app-relaunch with valid cookies
            // (which is fine — bridge reload is a no-op in that case
            // because the bridge's WebView is already loading the same
            // page in parallel).
            if host == "music.youtube.com" || host.hasSuffix(".youtube.com") {
                didFire = true
                onAuthenticated()
            }
        }
    }
}
