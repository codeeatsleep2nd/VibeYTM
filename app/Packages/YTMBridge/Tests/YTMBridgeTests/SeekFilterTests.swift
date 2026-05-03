import Foundation
import Testing
@testable import YTMBridge

// Ports src/hooks/seekFilter.test.ts. Time values are seconds (the TS
// version's `now` / `lastSeekAt` / `windowMs` were milliseconds — divided
// by 1000 here to match the Swift port's `TimeInterval` unit).

@Suite("SeekFilter.decide")
struct SeekFilterTests {
    let tolerance: TimeInterval = 2  // matches usePlayerState's SEEK_TOLERANCE_SECS
    let window: TimeInterval = 5     // matches SEEK_RECONCILE_WINDOW_MS / 1000

    @Test("accepts every event when no seek is pending")
    func acceptsWhenNotPending() {
        let decision = SeekFilter.decide(
            state: SeekFilterState(),
            positionSecs: 60,
            now: 1.0,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        #expect(decision == .accept(nextPending: false))
    }

    @Test("drops a stale far-from-target echo while a seek is pending")
    func dropsStaleFarEcho() {
        // User seeked to 180 s at t=1.0; bridge later emits a stale 60 s
        // (YTM hasn't moved its currentTime yet). Would snap useSmoothedPosition
        // backwards if it slipped through.
        let decision = SeekFilter.decide(
            state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
            positionSecs: 60,
            now: 1.5,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        #expect(decision == .drop)
    }

    @Test("keeps pending for the min-hold window even after on-target sighting")
    func keepsPendingDuringMinHold() {
        // Near-target reading 100 ms after seek — accept value but KEEP
        // pending so any straggler stale reading 200–500 ms later (same
        // bridge burst) is still filtered.
        let decision = SeekFilter.decide(
            state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
            positionSecs: 181,
            now: 1.1,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        #expect(decision == .accept(nextPending: true))
    }

    @Test("clears pending on-target after the min-hold window has elapsed")
    func clearsPendingAfterMinHold() {
        let decision = SeekFilter.decide(
            state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
            positionSecs: 181,
            now: 1.0 + SeekFilter.minHold + 0.1,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        #expect(decision == .accept(nextPending: false))
    }

    @Test("drops a stale straggler arriving after on-target but within min-hold")
    func dropsStragglerWithinMinHold() {
        // The exact regression this layer defends against: on-target #1 at
        // t=1.1 cleared the value into state; a stale 60 s straggler at
        // t=1.3 (still within min-hold) must be dropped, not accepted.
        let decision = SeekFilter.decide(
            // state.pending stays true thanks to the previous accept(nextPending: true).
            state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
            positionSecs: 60,
            now: 1.3,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        #expect(decision == .drop)
    }

    @Test("clears pending after the hard cap and accepts the event")
    func clearsAfterHardCap() {
        // 6 s past markSeek with no near-target event — give up on the filter
        // so the UI doesn't freeze.
        let decision = SeekFilter.decide(
            state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
            positionSecs: 60,
            now: 7.0,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        #expect(decision == .accept(nextPending: false))
    }

    @Test("keeps dropping echoes throughout the entire window, not just the first 800 ms")
    func dropsThroughoutWindow() {
        // Regression for the original bug — the previous 800 ms hard-cap let
        // echoes slip through after ~1 s, snapping the smoothed position back.
        let state = SeekFilterState(pending: true, lastSeekAt: 0, target: 180)

        for now in [0.1, 1.5, 3.0, 4.999] as [TimeInterval] {
            let decision = SeekFilter.decide(
                state: state,
                positionSecs: 60,
                now: now,
                toleranceSecs: tolerance,
                windowSecs: window
            )
            #expect(decision == .drop, "expected drop at now=\(now)")
        }

        // 5.0 s (== window) crosses the boundary; helper accepts.
        let boundary = SeekFilter.decide(
            state: state,
            positionSecs: 60,
            now: 5.0,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        if case .accept = boundary {
            // pass
        } else {
            Issue.record("expected accept at now=window boundary, got \(boundary)")
        }
    }

    @Test("treats far-from-target as drop even when target=0 (seek-to-start)")
    func dropsWhenTargetIsZero() {
        // User seeked back to 0. Stale echo at 60 should still be far from 0
        // and dropped.
        let decision = SeekFilter.decide(
            state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 0),
            positionSecs: 60,
            now: 1.5,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        #expect(decision == .drop)
    }

    @Test("uses absolute distance — backward overshoot is also near target")
    func absoluteDistanceBackwardOvershoot() {
        // YTM may overshoot slightly the other way during seek-back. 178
        // (target=180) is within tolerance. Within min-hold so pending stays.
        let decision = SeekFilter.decide(
            state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
            positionSecs: 178,
            now: 1.5,
            toleranceSecs: tolerance,
            windowSecs: window
        )
        #expect(decision == .accept(nextPending: true))
    }
}
