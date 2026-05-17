import Foundation
import Testing
@testable import VibeYTMApp

/// CRITICAL regression test (Sprint 0). Per app/SWIFTUI_CHECKLIST.md the
/// NowPlayingExpanded sheet has a 5-path dismissal contract that has been
/// re-broken THREE times in prior development cycles. This test guards
/// the AppRouter-flag-flip half of the contract: when an external caller
/// (or any of the 5 in-view paths) calls `router.dismissNowPlayingExpanded()`,
/// the observable flag flips false, which the sheet's
/// `.sheet(isPresented: $router.isNowPlayingExpanded)` binding observes
/// and dismisses the presented view.
///
/// The 5 in-view paths (chevron / Done / backdrop tap / Esc monitor /
/// explicit method call) all converge on the closure-based onDismiss
/// callback set up in PlayerChrome's `.sheet { ... onDismiss: { router.isNowPlayingExpanded = false } }`.
/// Each in-view path's wiring is exercised live in NowPlayingExpanded.swift
/// (full UI verification is XCUITest-level, deferred to a later sprint).
/// What this test locks down: the AppRouter side of the contract.
///
/// FORBIDDEN PATTERN: do NOT switch this contract to `@Environment(\.dismiss)`.
/// It has historically failed silently inside sheets with focus modifiers.
@MainActor
struct NowPlayingExpandedDismissalContractTests {

    @Test("Path 1-5 converge: dismissNowPlayingExpanded() flips flag false")
    func dismissMethodFlipsFlag() {
        let router = AppRouter()
        router.isNowPlayingExpanded = true
        router.dismissNowPlayingExpanded()
        #expect(router.isNowPlayingExpanded == false)
    }

    @Test("Direct flag write (e.g. from sheet's onDismiss closure) also flips it false")
    func directFlagWriteFlips() {
        let router = AppRouter()
        router.isNowPlayingExpanded = true
        router.isNowPlayingExpanded = false
        #expect(router.isNowPlayingExpanded == false)
    }

    @Test("Calling dismiss twice is idempotent — no crash")
    func doubleDismissIsIdempotent() {
        let router = AppRouter()
        router.isNowPlayingExpanded = true
        router.dismissNowPlayingExpanded()
        router.dismissNowPlayingExpanded()
        #expect(router.isNowPlayingExpanded == false)
    }

    @Test("Other sheet flags are independent — dismissing expanded does not touch queue or lyrics")
    func dismissExpandedDoesNotTouchOtherFlags() {
        let router = AppRouter()
        router.isNowPlayingExpanded = true
        router.isQueueOpen = true
        router.isLyricsOpen = true
        router.dismissNowPlayingExpanded()
        #expect(router.isNowPlayingExpanded == false)
        #expect(router.isQueueOpen == true, "Queue flag must be independent")
        #expect(router.isLyricsOpen == true, "Lyrics flag must be independent")
    }
}
