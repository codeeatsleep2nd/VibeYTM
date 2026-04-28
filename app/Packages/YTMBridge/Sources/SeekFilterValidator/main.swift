import Foundation
import YTMBridge

// CLT-only proxy for Tests/YTMBridgeTests/SeekFilterTests.swift. Runs the
// same 9 cases via inline assertions because `import Testing` fails on
// Command Line Tools 6.2 (Apple ships `_Testing_Foundation.framework` as
// a binary-only framework with no swiftmodule). Delete this target once
// Xcode 26 is installed and `swift test` works directly.

@main
struct Main {
    static func main() {
        let tolerance: TimeInterval = 2  // matches usePlayerState's SEEK_TOLERANCE_SECS
        let window: TimeInterval = 5     // matches SEEK_RECONCILE_WINDOW_MS / 1000

        struct Case {
            let name: String
            let body: () -> Bool
        }

        let cases: [Case] = [
            Case(name: "accepts every event when no seek is pending") {
                let d = SeekFilter.decide(
                    state: SeekFilterState(),
                    positionSecs: 60, now: 1.0,
                    toleranceSecs: tolerance, windowSecs: window
                )
                return d == .accept(nextPending: false)
            },
            Case(name: "drops a stale far-from-target echo while a seek is pending") {
                let d = SeekFilter.decide(
                    state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
                    positionSecs: 60, now: 1.5,
                    toleranceSecs: tolerance, windowSecs: window
                )
                return d == .drop
            },
            Case(name: "keeps pending for the min-hold window even after on-target sighting") {
                let d = SeekFilter.decide(
                    state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
                    positionSecs: 181, now: 1.1,
                    toleranceSecs: tolerance, windowSecs: window
                )
                return d == .accept(nextPending: true)
            },
            Case(name: "clears pending on-target after the min-hold window has elapsed") {
                let d = SeekFilter.decide(
                    state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
                    positionSecs: 181, now: 1.0 + SeekFilter.minHold + 0.1,
                    toleranceSecs: tolerance, windowSecs: window
                )
                return d == .accept(nextPending: false)
            },
            Case(name: "drops a stale straggler arriving after on-target but within min-hold") {
                let d = SeekFilter.decide(
                    state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
                    positionSecs: 60, now: 1.3,
                    toleranceSecs: tolerance, windowSecs: window
                )
                return d == .drop
            },
            Case(name: "clears pending after the hard cap and accepts the event") {
                let d = SeekFilter.decide(
                    state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
                    positionSecs: 60, now: 7.0,
                    toleranceSecs: tolerance, windowSecs: window
                )
                return d == .accept(nextPending: false)
            },
            Case(name: "keeps dropping echoes throughout the entire window, not just the first 800 ms") {
                let state = SeekFilterState(pending: true, lastSeekAt: 0, target: 180)
                for now in [0.1, 1.5, 3.0, 4.999] as [TimeInterval] {
                    let d = SeekFilter.decide(
                        state: state, positionSecs: 60, now: now,
                        toleranceSecs: tolerance, windowSecs: window
                    )
                    if d != .drop { return false }
                }
                let boundary = SeekFilter.decide(
                    state: state, positionSecs: 60, now: 5.0,
                    toleranceSecs: tolerance, windowSecs: window
                )
                if case .accept = boundary { return true }
                return false
            },
            Case(name: "treats far-from-target as drop even when target=0 (seek-to-start)") {
                let d = SeekFilter.decide(
                    state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 0),
                    positionSecs: 60, now: 1.5,
                    toleranceSecs: tolerance, windowSecs: window
                )
                return d == .drop
            },
            Case(name: "uses absolute distance — backward overshoot is also near target") {
                let d = SeekFilter.decide(
                    state: SeekFilterState(pending: true, lastSeekAt: 1.0, target: 180),
                    positionSecs: 178, now: 1.5,
                    toleranceSecs: tolerance, windowSecs: window
                )
                return d == .accept(nextPending: true)
            },
        ]

        var failed = 0
        for (i, c) in cases.enumerated() {
            let pass = c.body()
            let status = pass ? "PASS" : "FAIL"
            print("[\(status)] case \(i + 1)/\(cases.count): \(c.name)")
            if !pass { failed += 1 }
        }
        print("")
        if failed == 0 {
            print("All \(cases.count) cases passed.")
            exit(0)
        }
        print("\(failed) of \(cases.count) cases FAILED.")
        exit(1)
    }
}
