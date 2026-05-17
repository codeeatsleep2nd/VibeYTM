import SwiftUI
import OSLog
import PlayerCore

private let routerLog = Logger(subsystem: "com.vibeytm.dev", category: "Router")

/// Routes that any caller — view, AppIntent, deep-link handler — can request.
/// `navigate(to:)` translates the route into the corresponding mutation on
/// `AppRouter`'s observable state.
///
/// Adding a new route case: also handle it in `AppRouter.navigate(to:)`
/// and (if it's a deep-link target) `AppRouter.handle(deepLink:)`.
enum AppRoute: Hashable, Sendable {
    case sidebar(SidebarSection)
    case browse(BrowseDestination)
    case queue
    case lyrics
    case nowPlayingExpanded
    case search(query: String)
    case djCopilot(prompt: String?)

    // Deep-link entry routes. These typically come from AppIntents or the
    // `vibeytm://` URL scheme. For navigation, they map onto the browse
    // stack or transport actions; the actual `BridgeHost.play(...)` call
    // is the caller's responsibility (AppRouter is navigation only).
    case playTrack(videoId: String)
    case openAlbum(browseId: String)
    case openPlaylist(browseId: String)
    case openArtist(browseId: String)
}

/// Single source of truth for navigation, sidebar selection, and sheet/overlay
/// presentation state. Replaces the local `@State` that used to live in
/// `RootView` (`selection`, `browseStack`), `PlayerChrome` (`showQueue`), and
/// the various sheet flags scattered across views.
///
/// Why this exists: starting in Sprint 3, AppIntents and the `vibeytm://`
/// URL scheme need to push deep-links from OUTSIDE the SwiftUI view tree
/// into the app's navigation. Local `@State` is unreachable from those entry
/// points — a centralized `@Observable` router is the path.
///
/// Dismissal contract: `NowPlayingExpanded` historically broke when switched
/// to `@Environment(\.dismiss)`. Its caller's closure pattern is preserved;
/// `dismissNowPlayingExpanded()` is the canonical method that flips the
/// observable flag, which the closure invokes. The flag and the closure
/// together provide the contract — do not remove either.
@Observable
@MainActor
final class AppRouter {
    /// Currently-selected sidebar destination. Bound by `SidebarView`'s `List`
    /// and persisted via the same path as `PersistedState` (future).
    var selection: SidebarSection = .home

    /// Detail-pane navigation stack. Bound to `NavigationStack(path:)` by
    /// RootView; both user-driven NavigationLink pushes and AppIntent
    /// deep-link `append(destination)` calls mutate the same value.
    var browseStack = NavigationPath()

    /// Sheet flags. Each presented sheet still owns its own dismissal
    /// closure (preserves the NowPlayingExpanded 5-path dismissal contract).
    var isQueueOpen = false
    var isLyricsOpen = false
    var isNowPlayingExpanded = false
    /// Keyboard-shortcut cheatsheet sheet. Triggered by ⌘/ (registered in
    /// VibeYTMApp's CommandGroup).
    var isCheatsheetOpen = false

    init() {}

    /// Single funnel for any navigation intent. Views call this from their
    /// NavigationLink/sheet actions; AppIntents and the URL handler call it
    /// after parsing their input.
    func navigate(to route: AppRoute) {
        switch route {
        case .sidebar(let section):
            selection = section
        case .browse(let dest):
            browseStack.append(dest)
        case .queue:
            isQueueOpen = true
        case .lyrics:
            isLyricsOpen = true
        case .nowPlayingExpanded:
            isNowPlayingExpanded = true
        case .search(let query):
            selection = .search
            // SearchView reads its own query state; AppIntent-driven
            // pre-fill is a follow-up (would need a router-published
            // `pendingSearchQuery` to bridge cross-component).
            routerLog.debug("Search route requested with query: \(query, privacy: .public)")
        case .djCopilot:
            // Sprint 4 wires a `isDJCopilotOpen` flag when the Vibe sheet
            // surface lands. For Sprint 0 this is a no-op; logging the
            // prompt makes the intent visible during dev.
            routerLog.debug("DJ Copilot route requested (Sprint 4 feature)")
        case .playTrack(let videoId):
            // AppIntent `PlayTrackIntent.perform()` calls `BridgeHost.play`
            // directly. The router records the request but doesn't drive
            // the bridge.
            routerLog.debug("Play track route: \(videoId, privacy: .public) — caller drives bridge")
        case .openAlbum(let browseId):
            browseStack.append(BrowseDestination(browseId: browseId, title: ""))
        case .openPlaylist(let browseId):
            browseStack.append(BrowseDestination(browseId: browseId, title: ""))
        case .openArtist(let browseId):
            browseStack.append(BrowseDestination(browseId: browseId, title: ""))
        }
    }

    /// Parse a `vibeytm://` URL into the matching `AppRoute` and dispatch.
    /// Unknown schemes, hosts, or empty path components are silently dropped
    /// (a malformed URL must NEVER crash the app).
    ///
    /// Grammar:
    ///   - vibeytm://track/{videoId}
    ///   - vibeytm://album/{browseId}
    ///   - vibeytm://playlist/{browseId}
    ///   - vibeytm://artist/{browseId}
    ///   - vibeytm://queue
    ///   - vibeytm://vibe?prompt={text}
    func handle(deepLink url: URL) {
        guard url.scheme == "vibeytm" else {
            routerLog.debug("Deep link ignored — wrong scheme: \(url.scheme ?? "nil", privacy: .public)")
            return
        }
        guard let host = url.host else {
            routerLog.debug("Deep link ignored — no host")
            return
        }
        switch host {
        case "track":
            let id = url.lastPathComponent
            guard !id.isEmpty, id != "/" else { return }
            navigate(to: .playTrack(videoId: id))
        case "album":
            let id = url.lastPathComponent
            guard !id.isEmpty, id != "/" else { return }
            navigate(to: .openAlbum(browseId: id))
        case "playlist":
            let id = url.lastPathComponent
            guard !id.isEmpty, id != "/" else { return }
            navigate(to: .openPlaylist(browseId: id))
        case "artist":
            let id = url.lastPathComponent
            guard !id.isEmpty, id != "/" else { return }
            navigate(to: .openArtist(browseId: id))
        case "queue":
            navigate(to: .queue)
        case "vibe":
            let prompt = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "prompt" })?
                .value
            navigate(to: .djCopilot(prompt: prompt))
        default:
            routerLog.debug("Deep link ignored — unknown host: \(host, privacy: .public)")
        }
    }

    // MARK: - Sheet dismissal

    /// Canonical NowPlayingExpanded dismissal. The sheet caller's closure
    /// invokes this AND flips its own presentation flag (5-path dismissal
    /// contract per app/SWIFTUI_CHECKLIST.md). Both halves required.
    func dismissNowPlayingExpanded() {
        isNowPlayingExpanded = false
    }

    func dismissQueue() {
        isQueueOpen = false
    }

    func dismissLyrics() {
        isLyricsOpen = false
    }

    func dismissCheatsheet() {
        isCheatsheetOpen = false
    }
}
