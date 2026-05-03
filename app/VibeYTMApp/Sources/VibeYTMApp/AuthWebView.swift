import SwiftUI
@preconcurrency import WebKit

/// A visible WKWebView for first-time YTM sign-in. Shares
/// `WKWebsiteDataStore.default()` with the hidden audio engine, so a
/// successful login here automatically authenticates the engine — the
/// next bridge poll cycle flips `__VIBEYTM_LOGGED_IN__` to true and the
/// caller switches to the main UI.
///
/// We don't try to reuse the BridgeHost's hidden WKWebView (which would
/// require moving the view in and out of the visible window hierarchy and
/// fighting WebKit's navigation state). Two views, shared cookie store —
/// simpler and matches what Kaset / Pear Desktop do.
struct AuthWebView: NSViewRepresentable {
    let url: URL

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
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // No-op — the URL is fixed for the auth flow lifetime.
    }
}
