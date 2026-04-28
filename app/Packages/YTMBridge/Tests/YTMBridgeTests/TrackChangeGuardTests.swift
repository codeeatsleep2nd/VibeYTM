import Foundation
import Testing
@testable import YTMBridge

// Mirrors Sources/TrackChangeGuardValidator/main.swift. Runs once Xcode 26
// is installed and Swift Testing's `_Testing_Foundation` swiftmodule is
// available. See app/README.md "Known toolchain quirks".

@Suite("TrackChangeGuard.decideTrackChanged")
struct TrackChangeDecisionTests {
    @Test("same videoId → same-track, no rearm, position passes through")
    func sameVideoId() {
        let d = TrackChangeGuard.decideTrackChanged(
            previousVideoId: "abc",
            previousPositionSecs: 42,
            incomingVideoId: "abc"
        )
        #expect(d.isSameTrack)
        #expect(!d.armReconcileWindow)
        #expect(d.nextPositionSecs == 42)
    }

    @Test("different videoId → fresh, arm window, reset position to 0")
    func differentVideoId() {
        let d = TrackChangeGuard.decideTrackChanged(
            previousVideoId: "abc",
            previousPositionSecs: 42,
            incomingVideoId: "xyz"
        )
        #expect(!d.isSameTrack)
        #expect(d.armReconcileWindow)
        #expect(d.nextPositionSecs == 0)
    }

    @Test("previous nil (cold start) → fresh, arm, reset to 0")
    func coldStart() {
        let d = TrackChangeGuard.decideTrackChanged(
            previousVideoId: nil,
            previousPositionSecs: 0,
            incomingVideoId: "abc"
        )
        #expect(!d.isSameTrack)
        #expect(d.armReconcileWindow)
        #expect(d.nextPositionSecs == 0)
    }

    @Test("incoming nil (rare) → not same-track, arm window")
    func incomingNil() {
        let d = TrackChangeGuard.decideTrackChanged(
            previousVideoId: "abc",
            previousPositionSecs: 42,
            incomingVideoId: nil
        )
        #expect(!d.isSameTrack)
        #expect(d.armReconcileWindow)
    }
}

@Suite("TrackChangeGuard.decidePosition")
struct TrackChangePositionTests {
    @Test("outside reconcile window → accept any value")
    func outsideWindow() {
        let d = TrackChangeGuard.decidePosition(
            positionSecs: 9999,
            durationSecs: 180,
            lastTrackChangeAt: 0,
            now: 2.0
        )
        #expect(d == .accept)
    }

    @Test("inside window, position > freshTrackMaxPosition → drop")
    func droppedFreshMax() {
        let d = TrackChangeGuard.decidePosition(
            positionSecs: 200,
            durationSecs: 180,
            lastTrackChangeAt: 0,
            now: 0.5
        )
        #expect(d == .drop)
    }

    @Test("inside window, position > duration → drop")
    func droppedExceedsDuration() {
        let d = TrackChangeGuard.decidePosition(
            positionSecs: 6,
            durationSecs: 4,
            lastTrackChangeAt: 0,
            now: 0.5
        )
        #expect(d == .drop)
    }

    @Test("inside window, in-range position → accept")
    func inRangeAccept() {
        let d = TrackChangeGuard.decidePosition(
            positionSecs: 0.3,
            durationSecs: 180,
            lastTrackChangeAt: 0,
            now: 0.5
        )
        #expect(d == .accept)
    }

    @Test("inside window, duration nil → freshTrackMax filter still applies")
    func nilDuration() {
        let d = TrackChangeGuard.decidePosition(
            positionSecs: 7,
            durationSecs: nil,
            lastTrackChangeAt: 0,
            now: 0.5
        )
        #expect(d == .drop)
    }

    @Test("window boundary (now == lastTrackChangeAt + window) → accept")
    func windowBoundary() {
        let d = TrackChangeGuard.decidePosition(
            positionSecs: 9999,
            durationSecs: 180,
            lastTrackChangeAt: 0,
            now: TrackChangeGuard.reconcileWindow
        )
        #expect(d == .accept)
    }

    @Test("duration 0 (unknown) → only freshTrackMax filter applies")
    func zeroDuration() {
        let allowed = TrackChangeGuard.decidePosition(
            positionSecs: 4.9,
            durationSecs: 0,
            lastTrackChangeAt: 0,
            now: 0.5
        )
        let dropped = TrackChangeGuard.decidePosition(
            positionSecs: 5.1,
            durationSecs: 0,
            lastTrackChangeAt: 0,
            now: 0.5
        )
        #expect(allowed == .accept)
        #expect(dropped == .drop)
    }
}
