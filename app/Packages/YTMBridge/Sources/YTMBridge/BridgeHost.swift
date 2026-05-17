import Foundation
import PlayerCore
import AppKit
import OSLog
@preconcurrency import WebKit

private let bridgeLog = Logger(subsystem: "com.vibeytm.dev", category: "YTMBridge")

// Hidden WKWebView host for YouTube Music. Replaces the Rust-side
// `webview_bridge` crate from the Tauri tree. WebKit APIs are mostly
// main-thread-only, so this is `@MainActor` rather than an `actor` — the
// alternative (an actor proxying every call to a MainActor host) buys us
// nothing because the bridge already serializes work through the run loop.
//
// Architecture: load music.youtube.com with the user-script bridge, poll
// the JS state global on a 150 ms cadence (matching the Rust poller),
// decode the merged envelope into a `BridgePollSnapshot`, and hand it
// to the caller's closure. The IPC entry points (`play`, `setVolume`,
// `seek`, `navigate`, `callYTMAPI`, …) round-trip through
// `evaluateJavaScript` with explicit `WKContentWorld.page` targeting.

/// Configuration for the bridge.
public struct BridgeConfiguration: Sendable {
    /// URL the hidden audio engine should load. Default points at the
    /// YouTube Music root; pass a track-deep-link to resume from a saved
    /// playback position.
    public let initialURL: URL

    /// Poll cadence in seconds. Matches the Rust poller's 150 ms.
    public let pollInterval: TimeInterval

    /// User agent string. YTM gates Premium / DRM features behind a
    /// recognised desktop UA — using `WKWebView`'s default Mac Safari UA
    /// is fine, but we set it explicitly so behavior doesn't drift if
    /// Apple changes the default.
    public let userAgent: String

    public init(
        initialURL: URL = URL(string: "https://music.youtube.com/")!,
        pollInterval: TimeInterval = 0.15,
        userAgent: String =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
            + "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    ) {
        self.initialURL = initialURL
        self.pollInterval = pollInterval
        self.userAgent = userAgent
    }
}

/// Snapshot returned by one poll cycle. `bridge` is `nil` when YTM hasn't
/// yet rendered a `<video>` element (e.g. on the sign-in page). `loggedIn`
/// is independent — its value comes from `window.__VIBEYTM_LOGGED_IN__`,
/// which the inject script sets before the player exists.
public struct BridgePollSnapshot: Sendable {
    public let bridge: BridgeState?
    public let loggedIn: Bool?
    public let account: Account?
    public let timestamp: Date

    public init(
        bridge: BridgeState?,
        loggedIn: Bool?,
        account: Account? = nil,
        timestamp: Date = Date()
    ) {
        self.bridge = bridge
        self.loggedIn = loggedIn
        self.account = account
        self.timestamp = timestamp
    }
}

@MainActor
public final class BridgeHost {
    public typealias SnapshotHandler = @MainActor (BridgePollSnapshot) -> Void

    private let configuration: BridgeConfiguration
    private let onSnapshot: SnapshotHandler
    private let webView: WKWebView
    /// Off-screen NSWindow that owns the hidden bridge WebView. Without
    /// this, WKWebView's `<video>` element refuses to start playback —
    /// macOS gates audio on whether the WebView is part of an attached
    /// view hierarchy. Tauri's hidden-webview impl wraps its WebView in
    /// an NSWindow internally; we mirror that here.
    private var hiddenWindow: NSWindow?
    private var pollTimer: Timer?
    private var isStarted = false
    /// Set while `poll()` is in flight so the 150 ms timer doesn't
    /// stack queued polls during a YTM page navigation (which can
    /// suspend `evaluateJavaScript` for 3–15 s). Without this guard,
    /// 20+ polls accumulate on the main actor and contend for it
    /// when the navigation completes.
    private var pollInFlight = false

    public init(
        configuration: BridgeConfiguration = .init(),
        onSnapshot: @escaping SnapshotHandler
    ) {
        self.configuration = configuration
        self.onSnapshot = onSnapshot

        let userContentController = WKUserContentController()
        for name in ["ytm-player-bridge", "ytm-compat"] {
            if let script = Self.loadInjectedScript(named: name) {
                // Pin the user scripts to `.page` world explicitly. Without
                // this, async evaluateJavaScript calls from Swift land in
                // a different content world and cannot see the user
                // script's globals — diagnosed via a `length` round-trip
                // that disagreed across consecutive calls.
                let userScript = WKUserScript(
                    source: script,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: false,
                    in: .page
                )
                userContentController.addUserScript(userScript)
            }
        }

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContentController
        configuration.websiteDataStore = .default()
        // Allow the page's video / audio media to play without a click.
        configuration.mediaTypesRequiringUserActionForPlayback = []

        self.webView = WKWebView(frame: .zero, configuration: configuration)
        self.webView.customUserAgent = self.configuration.userAgent
    }

    /// Begin loading YTM and polling the state global. Idempotent — safe
    /// to call once during app launch and ignore the result.
    public func start() {
        guard !isStarted else { return }
        isStarted = true

        // Park the WebView in an off-screen NSWindow so AppKit treats it
        // as live and lets WebKit's media engine play audio. A bare
        // detached WKWebView refuses playback on macOS regardless of
        // mediaTypesRequiringUserActionForPlayback. The window is
        // borderless, alpha 0, far off-screen, and excluded from the
        // window-cycle (Cmd+`) so the user never accidentally focuses
        // it. `ignoresCycle` keeps it out of Cmd+` rotation and
        // `stationary` prevents it from migrating between Spaces.
        let window = NSWindow(
            contentRect: NSRect(x: -10000, y: -10000, width: 800, height: 600),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.alphaValue = 0
        window.isReleasedWhenClosed = false
        window.collectionBehavior = [.transient, .ignoresCycle, .stationary]
        window.hidesOnDeactivate = false
        window.contentView = webView
        webView.frame = NSRect(x: 0, y: 0, width: 800, height: 600)
        window.orderBack(nil)
        self.hiddenWindow = window

        let request = URLRequest(url: configuration.initialURL)
        webView.load(request)

        let interval = configuration.pollInterval
        let timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            // Timer fires on the main run loop; hop to MainActor to call
            // back into self.
            Task { @MainActor [weak self] in
                self?.poll()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.pollTimer = timer
    }

    public func stop() {
        pollTimer?.invalidate()
        pollTimer = nil
        isStarted = false
        // Reset pollInFlight too so a `stop() ... start()` cycle on the
        // same instance starts cleanly. Without this reset, an
        // in-flight poll task captured `[weak self]`; if `stop()` runs
        // before that task's defer fires, `self` is nilled and the
        // defer never executes, stranding `pollInFlight = true` and
        // permanently blocking polls after a subsequent `start()`.
        pollInFlight = false
        // Tear down the hidden NSWindow so the WKWebView can drop its
        // process and reclaim memory. `isReleasedWhenClosed = false`
        // means we have to nil the reference ourselves.
        hiddenWindow?.contentView = nil
        hiddenWindow?.close()
        hiddenWindow = nil
    }

    /// Underlying WKWebView, exposed for diagnostics / Web Inspector
    /// access only. **The view IS parented to an off-screen NSWindow**
    /// (see `start()`); a detached WKWebView refuses media playback on
    /// macOS regardless of `mediaTypesRequiringUserActionForPlayback`.
    /// Moving this reference elsewhere will break audio.
    public var hiddenWebView: WKWebView { webView }

    // MARK: - Player commands

    /// Send a `__VIBEYTM_COMMAND__(cmd[, args])` invocation into the YTM
    /// page. Mirrors the Rust `exec_playback_command_with_args` helper —
    /// see `webview_bridge/mod.rs` for the original. `args` is optional;
    /// when present it's JSON-encoded directly into the call site.
    public func command(_ cmd: String, args: [String: Sendable]? = nil) async throws {
        let argsClause: String
        if let args, !args.isEmpty {
            let data = try JSONSerialization.data(withJSONObject: args, options: [])
            let json = String(data: data, encoding: .utf8) ?? "{}"
            argsClause = ", \(json)"
        } else {
            argsClause = ""
        }
        // Wrapped in a guard so cycles before __VIBEYTM_COMMAND__ is
        // installed (initial page load) don't throw.
        let js = "if(window.__VIBEYTM_COMMAND__){window.__VIBEYTM_COMMAND__('\(cmd)'\(argsClause));}"
        _ = try await webView.evaluateJavaScript(js, in: nil, contentWorld: .page) as Any?
    }

    public func play() async throws { try await command("play") }
    public func pause() async throws { try await command("pause") }
    public func togglePlay() async throws { try await command("toggle_play") }
    public func next() async throws { try await command("next") }
    public func previous() async throws { try await command("previous") }

    /// Seek to `secs` from the start of the current track. The caller is
    /// responsible for arming `BridgePipelineState.seekFilter` if they
    /// want stale POSITION_UPDATED echoes filtered (see SeekFilter).
    public func seek(secs: Double) async throws {
        try await command("seek", args: ["secs": max(0, secs)])
    }

    /// Set volume to `level` in the [0, 1] range. The caller is
    /// responsible for updating `BridgePipelineState.volumeSettle.lastPushAt`
    /// to `Date().timeIntervalSinceReferenceDate` so VolumeSettle's
    /// stored-vs-reported reconcile fires for the next 2 s — without
    /// that, the same regression that issue #76 closed re-opens.
    public func setVolume(level: Double) async throws {
        let clamped = min(max(level, 0), 1)
        try await command("set_volume", args: ["level": clamped])
    }

    public func toggleShuffle() async throws { try await command("toggle_shuffle") }
    /// Cycle the repeat mode: NONE → ALL → ONE → NONE. The JS handler is
    /// named `cycle_repeat` (not `toggle_repeat`) — sending the wrong name
    /// silently no-ops and the repeat button looks dead. Verified against
    /// the cmd switch in `ytm-player-bridge.js`.
    public func toggleRepeatMode() async throws { try await command("cycle_repeat") }
    public func toggleLike() async throws { try await command("toggle_like") }

    /// Navigate the hidden YTM webview to a track. Mirrors the Rust
    /// `navigate_to_track` helper — uses an anchor click so YTM's polymer
    /// router intercepts the URL change without a full page reload, and
    /// stamps `__VIBEYTM_TARGET_VID__` so the poller ignores stale DOM
    /// state until the target loads.
    ///
    /// When `playlistId` is omitted we fall back to the song-radio
    /// (`RDAMVM<videoId>`) so YTM stays in audio mode rather than
    /// switching to the music-video view that `/watch?v=` alone produces.
    public func navigate(
        videoId: String,
        playlistId: String? = nil,
        positionSecs: Double = 0
    ) async throws {
        let safeVid = sanitizeYTMID(videoId)
        guard !safeVid.isEmpty else { throw BridgeAPIError.encodingFailed }
        let listId: String = {
            if let provided = playlistId, !provided.isEmpty {
                return sanitizeYTMID(provided)
            }
            return "RDAMVM\(safeVid)"
        }()
        let timeClause: String = positionSecs > 0
            ? "&t=\(Int(positionSecs))s"
            : ""
        let js = """
        (function() {
          var vid = '\(safeVid)';
          window.__VIBEYTM_TARGET_VID__ = vid;
          var a = document.createElement('a');
          a.href = '/watch?v=' + vid + '&list=\(listId)\(timeClause)';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(function() { try { document.body.removeChild(a); } catch (e) {} }, 100);
          return 'ok';
        })();
        """
        _ = try await webView.evaluateJavaScript(js, in: nil, contentWorld: .page) as Any?
    }

    /// Conservative whitelist for ids we substitute into JS — only chars
    /// that appear in real YTM video / playlist ids. Defends against any
    /// caller that hands in an externally-provided string.
    private func sanitizeYTMID(_ raw: String) -> String {
        let allowed: Set<Character> = Set(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        )
        return String(raw.prefix(120).filter { allowed.contains($0) })
    }

    // MARK: - YTM API (Innertube)

    private static var apiRequestId: Int = 0

    /// Call a YTM Innertube endpoint (browse, search, next, etc.) by firing
    /// a `fetch()` from inside the YTM origin in our hidden WebView. The
    /// fetch picks up the authenticated cookie set automatically and the
    /// JS layer attaches the SAPISIDHASH header, so logged-in queries
    /// (private library, recommendations, like state) work without us
    /// shipping any auth code on the Swift side. Mirrors the Rust
    /// `webview_bridge/api.rs::ytm_api_call` helper.
    ///
    /// Returns the raw JSON response body as `Data`. Callers parse with
    /// `JSONSerialization` or a typed Codable struct.
    public func callYTMAPI(endpoint: String, body: [String: Any]) async throws -> Data {
        // Retry up to 5 times on transient errors. Two patterns:
        //   • "Load failed" — observed when YTM's ytcfg / cookies / SAPISID
        //     hash haven't plumbed through yet on a fresh page load.
        //   • timeout — observed when the fetch promise never resolves
        //     (the .then/.catch chain doesn't fire). Same root cause:
        //     YTM's own `fetchAccountFromApi` logs `fetchAccount error:
        //     Load failed` on attempt 1, then succeeds ~2.5 s later.
        var lastError: Error?
        for attempt in 0..<5 {
            do {
                return try await callYTMAPIOnce(endpoint: endpoint, body: body)
            } catch let error as BridgeAPIError {
                lastError = error
                let retryable: Bool = {
                    switch error {
                    case .timeout: return true
                    case .fetchFailed(let msg):
                        return msg.contains("Load failed") || msg.contains("network")
                    case .encodingFailed: return false
                    }
                }()
                if retryable {
                    try? await Task.sleep(nanoseconds: UInt64(500_000_000 * (attempt + 1)))
                    continue
                }
                throw error
            } catch {
                throw error
            }
        }
        throw lastError ?? BridgeAPIError.timeout
    }

    private func callYTMAPIOnce(endpoint: String, body: [String: Any]) async throws -> Data {
        Self.apiRequestId &+= 1
        let reqId = Self.apiRequestId

        let bodyData = try JSONSerialization.data(withJSONObject: body, options: [])
        guard let bodyJSON = String(data: bodyData, encoding: .utf8) else {
            throw BridgeAPIError.encodingFailed
        }

        let fireJS = Self.fireJavaScript(reqId: reqId, endpoint: endpoint, bodyJSON: bodyJSON)
        _ = try await webView.evaluateJavaScript(fireJS, in: nil, contentWorld: .page) as Any?

        let readJS = """
        (function() {
          var r = window.__VIBEYTM_API_\(reqId)__;
          if (r !== null && r !== undefined) {
            delete window['__VIBEYTM_API_\(reqId)__'];
            return r;
          }
          return null;
        })();
        """

        // Per-attempt timeout. Most successful Innertube calls complete in
        // < 1 s; a 6-second ceiling gives slow connections room while
        // exiting fast on legitimately stuck fetches so the retry loop
        // can take another swing.
        let deadline = Date().addingTimeInterval(6)
        while Date() < deadline {
            try await Task.sleep(nanoseconds: 150_000_000)
            // Catch the read explicitly so a real WK error (context
            // gone, content-process crash, content-world drift) doesn't
            // get silently absorbed as "result not ready yet". The
            // previous `try?` form turned every error into another 6 s
            // of fruitless polling.
            let result: Any?
            do {
                result = try await webView.evaluateJavaScript(readJS, in: nil, contentWorld: .page)
            } catch {
                bridgeLog.warning("API poll read failed for reqId=\(reqId, privacy: .public): \((error as NSError).localizedDescription, privacy: .public)")
                throw BridgeAPIError.fetchFailed(message: (error as NSError).localizedDescription)
            }
            if let s = result as? String {
                if s.hasPrefix("VIBEYTM_ERROR:") {
                    throw BridgeAPIError.fetchFailed(message: String(s.dropFirst("VIBEYTM_ERROR:".count)))
                }
                return s.data(using: .utf8) ?? Data()
            }
        }
        throw BridgeAPIError.timeout
    }

    private static func fireJavaScript(reqId: Int, endpoint: String, bodyJSON: String) -> String {
        return #"""
        (function() {
          window.__VIBEYTM_API_\#(reqId)__ = null;
          // Surface synchronous setup failures (no ytcfg, malformed body,
          // cookie missing) into the api global so the Swift caller can
          // distinguish "still pending" from "errored before fetch".
          if (window.location.hostname !== 'music.youtube.com') {
            window.__VIBEYTM_API_\#(reqId)__ = 'VIBEYTM_ERROR:not on music.youtube.com';
            return 'fired';
          }
          function makeAuth() {
            var m = document.cookie.match(/SAPISID=([^;]+)/);
            if (!m) return Promise.resolve(null);
            var sapisid = m[1];
            var ts = Math.floor(Date.now() / 1000);
            var origin = 'https://music.youtube.com';
            var input = ts + ' ' + sapisid + ' ' + origin;
            return crypto.subtle.digest('SHA-1', new TextEncoder().encode(input)).then(function(buf) {
              var hex = Array.from(new Uint8Array(buf)).map(function(b) {
                return b.toString(16).padStart(2, '0');
              }).join('');
              return 'SAPISIDHASH ' + ts + '_' + hex;
            });
          }
          var ytctx = null, ytApiKey = null;
          try {
            if (window.ytcfg && typeof window.ytcfg.get === 'function') {
              ytctx = window.ytcfg.get('INNERTUBE_CONTEXT');
              ytApiKey = window.ytcfg.get('INNERTUBE_API_KEY');
            }
          } catch (e) {}
          makeAuth().then(function(auth) {
            var headers = {
              'Content-Type': 'application/json',
              'X-Origin': 'https://music.youtube.com',
              'X-Goog-AuthUser': '0',
              'X-YouTube-Client-Name': '67',
              'X-YouTube-Client-Version': (ytctx && ytctx.client && ytctx.client.clientVersion) || '1.20250407.01.00'
            };
            if (auth) headers['Authorization'] = auth;
            // Relative URL — WKWebView's same-origin fetch from the
            // injected script context fails with "Load failed" when an
            // absolute https://music.youtube.com URL is used, even though
            // the page IS on music.youtube.com. The bridge's own
            // fetchAccountFromApi succeeds with a relative path, so we
            // mirror that.
            var url = '/youtubei/v1/\#(endpoint)?prettyPrint=false';
            if (ytApiKey) url += '&key=' + encodeURIComponent(ytApiKey);
            var ctx = ytctx || {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20250407.01.00',
                hl: navigator.language || 'en',
                gl: 'US'
              }
            };
            return fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: headers,
              body: JSON.stringify(Object.assign({ context: ctx }, \#(bodyJSON)))
            });
          })
          .then(function(r) { return r.text(); })
          .then(function(t) { window.__VIBEYTM_API_\#(reqId)__ = t; })
          .catch(function(e) { window.__VIBEYTM_API_\#(reqId)__ = 'VIBEYTM_ERROR:' + (e && e.message ? e.message : e); });
          return 'fired';
        })();
        """#
    }

    // MARK: - Private

    private func poll() {
        // Single round-trip that returns both __VIBEYTM_STATE__ and
        // __VIBEYTM_LOGGED_IN__ — saves an extra evaluateJavaScript per
        // cycle. JSON.stringify gives us a round-trippable payload; the
        // unwrap on the Swift side is a String so we can treat the
        // bridge as opaque until the decoder lands.
        let js = """
        (function () {
          var s = window.__VIBEYTM_STATE__;
          var q = window.__VIBEYTM_QUEUE__ || [];
          var l = window.__VIBEYTM_LOGGED_IN__;
          var a = window.__VIBEYTM_ACCOUNT__ || null;
          var d = window.__VIBEYTM_DEBUG__ || [];
          // Merge queue into state so the Swift decoder gets one object.
          // The inject script's queue items already use the same field
          // names as Track (videoId/title/artist/album/artworkUrl/durationSecs).
          var merged = null;
          if (s != null) {
            merged = {};
            for (var k in s) merged[k] = s[k];
            merged.queue = q;
          }
          return JSON.stringify({
            state: merged,
            loggedIn: l == null ? null : l,
            account: a,
            debug: d.slice(-15)
          });
        })();
        """

        // Skip the cycle if a previous poll is still in flight. YTM
        // page navigation can suspend evaluateJavaScript for 3–15 s;
        // without this guard the 150 ms timer would queue 20+ pending
        // tasks on the main actor, all racing for it once navigation
        // settles. The guard keeps the poll cadence honest.
        guard !pollInFlight else { return }
        pollInFlight = true

        // Use the async API + Task so the explicit content-world targeting
        // is unambiguous (the older closure form doesn't accept a content
        // world parameter on this SDK).
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.pollInFlight = false }
            let result: Any?
            do {
                result = try await self.webView.evaluateJavaScript(js, in: nil, contentWorld: .page)
            } catch {
                self.handleEvalError(error)
                return
            }
            self.processSnapshot(result)
        }
    }

    /// Decode the snapshot envelope returned by the poll JS.
    private func processSnapshot(_ result: Any?) {
        guard let raw = result as? String,
              let data = raw.data(using: .utf8),
              let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return
        }
        let bridgeState: BridgeState? = {
            guard let v = envelope["state"], !(v is NSNull) else { return nil }
            guard let bytes = try? JSONSerialization.data(
                withJSONObject: v,
                options: [.fragmentsAllowed]
            ) else { return nil }
            return try? JSONDecoder().decode(BridgeState.self, from: bytes)
        }()
        let loggedIn: Bool? = {
            guard let v = envelope["loggedIn"], !(v is NSNull) else { return nil }
            return v as? Bool
        }()
        let account: Account? = {
            guard let raw = envelope["account"] as? [String: Any] else { return nil }
            let name = raw["name"] as? String ?? ""
            let avatarUrl = raw["avatarUrl"] as? String ?? ""
            guard !name.isEmpty || !avatarUrl.isEmpty else { return nil }
            return Account(name: name, avatarUrl: avatarUrl)
        }()
        // Surface the JS bridge's debug ring for out-of-band diagnostics.
        // Overwritten every cycle (latest wins) at /tmp/vibeytm-bridge-debug.log.
        let debug = (envelope["debug"] as? [String]) ?? []
        try? debug.joined(separator: "\n").write(
            toFile: "/tmp/vibeytm-bridge-debug.log",
            atomically: true,
            encoding: .utf8
        )
        let snapshot = BridgePollSnapshot(
            bridge: bridgeState,
            loggedIn: loggedIn,
            account: account
        )
        self.onSnapshot(snapshot)
    }

    private func handleEvalError(_ error: Error) {
        let nsError = error as NSError
        guard nsError.domain == WKError.errorDomain else {
            bridgeLog.warning("evaluateJavaScript failed (\(nsError.domain, privacy: .public) #\(nsError.code, privacy: .public)): \(nsError.localizedDescription, privacy: .public)")
            return
        }
        // Match WK error codes by their stable numeric value, NOT by
        // `localizedDescription` — that's locale-dependent and would
        // mis-classify on a non-English macOS.
        switch nsError.code {
        case WKError.javaScriptResultTypeIsUnsupported.rawValue:
            // Benign: during the first 1–2 s of a page navigation the
            // page's globals haven't been written yet. Demote to debug.
            bridgeLog.debug("evaluateJavaScript transient (result type unsupported)")
        case WKError.webContentProcessTerminated.rawValue:
            // The view's JS context is gone; reload to recover.
            // Without this the poll loop keeps ticking against a dead
            // context until the user restarts the app.
            bridgeLog.error("WKWebView content process terminated — reloading bridge")
            webView.reload()
        default:
            bridgeLog.warning("evaluateJavaScript failed (WKError #\(nsError.code, privacy: .public)): \(nsError.localizedDescription, privacy: .public)")
        }
    }

    private static func loadInjectedScript(named name: String) -> String? {
        guard let url = Bundle.module.url(
            forResource: name,
            withExtension: "js",
            subdirectory: "InjectedScripts"
        ) else {
            // Packaging bug — the resource is missing from the bundle.
            // Without these scripts the bridge can never report state,
            // so an explicit fault is far more actionable than the
            // silent "no snapshot ever fires" failure mode the
            // previous nil-return produced.
            bridgeLog.fault("Injected script missing from bundle: \(name, privacy: .public).js — bundle resources misconfigured")
            assertionFailure("Injected script \(name).js missing from YTMBridge bundle")
            return nil
        }
        do {
            return try String(contentsOf: url, encoding: .utf8)
        } catch {
            bridgeLog.fault("Could not read injected script \(name, privacy: .public).js: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}

public enum BridgeAPIError: Error, Sendable {
    case encodingFailed
    case timeout
    case fetchFailed(message: String)
}
