import Foundation
import Testing
import SwiftUI
@testable import VibeYTMApp

/// Tests for AppRouter — the single source of truth for navigation,
/// sidebar selection, and sheet presentation introduced in Sprint 0.
///
/// Coverage: every AppRoute case round-trips through navigate(to:); the
/// vibeytm:// deep-link parser handles all 6 hosts (track / album /
/// playlist / artist / queue / vibe); malformed URLs are silently
/// dropped; sheet dismissal flips the right flag.
@MainActor
struct AppRouterTests {
    // MARK: - navigate(to:)

    @Test("Sidebar route switches selection")
    func navigateSidebarSwitchesSelection() {
        let router = AppRouter()
        router.navigate(to: .sidebar(.albums))
        #expect(router.selection == .albums)
    }

    @Test("Browse route appends to NavigationPath")
    func navigateBrowseAppendsToPath() {
        let router = AppRouter()
        #expect(router.browseStack.isEmpty)
        router.navigate(to: .browse(BrowseDestination(browseId: "MPRE_x", title: "Test Album")))
        #expect(router.browseStack.count == 1)
    }

    @Test("Queue route flips isQueueOpen")
    func navigateQueueFlipsFlag() {
        let router = AppRouter()
        #expect(router.isQueueOpen == false)
        router.navigate(to: .queue)
        #expect(router.isQueueOpen == true)
    }

    @Test("Lyrics route flips isLyricsOpen")
    func navigateLyricsFlipsFlag() {
        let router = AppRouter()
        router.navigate(to: .lyrics)
        #expect(router.isLyricsOpen == true)
    }

    @Test("NowPlayingExpanded route flips flag")
    func navigateExpandedFlipsFlag() {
        let router = AppRouter()
        router.navigate(to: .nowPlayingExpanded)
        #expect(router.isNowPlayingExpanded == true)
    }

    @Test("Search route switches sidebar selection to .search")
    func navigateSearchSelectsSearchSection() {
        let router = AppRouter()
        router.navigate(to: .search(query: "hello"))
        #expect(router.selection == .search)
    }

    @Test("openAlbum / openPlaylist / openArtist all append to NavigationPath",
          arguments: [
            AppRoute.openAlbum(browseId: "MPRE_abc"),
            AppRoute.openPlaylist(browseId: "VL_pl1"),
            AppRoute.openArtist(browseId: "UC_art"),
          ])
    func navigateOpenBrowseAppendsToPath(route: AppRoute) {
        let router = AppRouter()
        router.navigate(to: route)
        #expect(router.browseStack.count == 1)
    }

    // MARK: - handle(deepLink:)

    @Test("Deep link vibeytm://track/{id} dispatches playTrack")
    func deepLinkTrackDispatches() {
        let router = AppRouter()
        router.handle(deepLink: URL(string: "vibeytm://track/dQw4w9WgXcQ")!)
        // navigate(.playTrack) is a no-op in AppRouter itself (caller drives
        // the bridge); verify no crash + state untouched.
        #expect(router.browseStack.isEmpty)
        #expect(router.isQueueOpen == false)
    }

    @Test("Deep link vibeytm://album/{id} pushes onto browseStack")
    func deepLinkAlbumPushesPath() {
        let router = AppRouter()
        router.handle(deepLink: URL(string: "vibeytm://album/MPREb_abc")!)
        #expect(router.browseStack.count == 1)
    }

    @Test("Deep link vibeytm://playlist/{id} pushes onto browseStack")
    func deepLinkPlaylistPushesPath() {
        let router = AppRouter()
        router.handle(deepLink: URL(string: "vibeytm://playlist/VLPL_x")!)
        #expect(router.browseStack.count == 1)
    }

    @Test("Deep link vibeytm://artist/{id} pushes onto browseStack")
    func deepLinkArtistPushesPath() {
        let router = AppRouter()
        router.handle(deepLink: URL(string: "vibeytm://artist/UC_art")!)
        #expect(router.browseStack.count == 1)
    }

    @Test("Deep link vibeytm://queue opens queue sheet")
    func deepLinkQueueOpensSheet() {
        let router = AppRouter()
        router.handle(deepLink: URL(string: "vibeytm://queue")!)
        #expect(router.isQueueOpen == true)
    }

    @Test("Deep link vibeytm://vibe?prompt= dispatches djCopilot (Sprint 4 no-op)")
    func deepLinkVibeDispatches() {
        let router = AppRouter()
        // djCopilot navigate is a no-op until Sprint 4 wires the flag;
        // verify no crash, no state change.
        router.handle(deepLink: URL(string: "vibeytm://vibe?prompt=darker")!)
        #expect(router.browseStack.isEmpty)
    }

    @Test("Malformed deep link is no-op (wrong scheme)")
    func deepLinkWrongSchemeIsNoOp() {
        let router = AppRouter()
        router.handle(deepLink: URL(string: "https://example.com/track/x")!)
        #expect(router.browseStack.isEmpty)
        #expect(router.isQueueOpen == false)
    }

    @Test("Deep link with unknown host is no-op")
    func deepLinkUnknownHostIsNoOp() {
        let router = AppRouter()
        router.handle(deepLink: URL(string: "vibeytm://garbage")!)
        #expect(router.browseStack.isEmpty)
    }

    @Test("Deep link with empty path component is no-op (vibeytm://track/)")
    func deepLinkEmptyPathIsNoOp() {
        let router = AppRouter()
        router.handle(deepLink: URL(string: "vibeytm://track/")!)
        #expect(router.browseStack.isEmpty)
    }

    // MARK: - Dismissal

    @Test("dismissNowPlayingExpanded flips flag false")
    func dismissExpandedFlipsFlag() {
        let router = AppRouter()
        router.isNowPlayingExpanded = true
        router.dismissNowPlayingExpanded()
        #expect(router.isNowPlayingExpanded == false)
    }

    @Test("dismissQueue flips flag false")
    func dismissQueueFlipsFlag() {
        let router = AppRouter()
        router.isQueueOpen = true
        router.dismissQueue()
        #expect(router.isQueueOpen == false)
    }

    @Test("dismissLyrics flips flag false")
    func dismissLyricsFlipsFlag() {
        let router = AppRouter()
        router.isLyricsOpen = true
        router.dismissLyrics()
        #expect(router.isLyricsOpen == false)
    }

    // MARK: - Default initial state

    @Test("Default initial state is home / no sheets / empty stack")
    func defaultInitialState() {
        let router = AppRouter()
        #expect(router.selection == .home)
        #expect(router.browseStack.isEmpty)
        #expect(router.isQueueOpen == false)
        #expect(router.isLyricsOpen == false)
        #expect(router.isNowPlayingExpanded == false)
    }
}
