import Foundation
import YTMBridge

// CLT-only proxy for Tests/YTMBridgeTests/TrackChangeGuardTests.swift.
// Same rationale as the other validators — `import Testing` fails on
// Command Line Tools 6.2 because `_Testing_Foundation.framework` ships
// without a swiftmodule. Delete this target once Xcode 26 is installed.

@main
struct Main {
    static func main() {
        struct Case {
            let name: String
            let body: () -> Bool
        }

        let cases: [Case] = [
            // MARK: - decideTrackChanged

            Case(name: "decideTrackChanged: same videoId → same-track, no rearm, position passes through") {
                let d = TrackChangeGuard.decideTrackChanged(
                    previousVideoId: "abc",
                    previousPositionSecs: 42,
                    incomingVideoId: "abc"
                )
                return d.isSameTrack && !d.armReconcileWindow && d.nextPositionSecs == 42
            },
            Case(name: "decideTrackChanged: different videoId → fresh, arm window, reset to 0") {
                let d = TrackChangeGuard.decideTrackChanged(
                    previousVideoId: "abc",
                    previousPositionSecs: 42,
                    incomingVideoId: "xyz"
                )
                return !d.isSameTrack && d.armReconcileWindow && d.nextPositionSecs == 0
            },
            Case(name: "decideTrackChanged: previous nil (cold start) → fresh, arm, reset to 0") {
                // Matches the TS `!!prev.track` guard — first track is treated
                // as a real change.
                let d = TrackChangeGuard.decideTrackChanged(
                    previousVideoId: nil,
                    previousPositionSecs: 0,
                    incomingVideoId: "abc"
                )
                return !d.isSameTrack && d.armReconcileWindow && d.nextPositionSecs == 0
            },
            Case(name: "decideTrackChanged: incoming nil (rare) → not same-track, arm window") {
                let d = TrackChangeGuard.decideTrackChanged(
                    previousVideoId: "abc",
                    previousPositionSecs: 42,
                    incomingVideoId: nil
                )
                return !d.isSameTrack && d.armReconcileWindow
            },

            // MARK: - decidePosition

            Case(name: "decidePosition: outside reconcile window → accept any value") {
                // Window is 1.5 s; 2 s after track change is well past it.
                let d = TrackChangeGuard.decidePosition(
                    positionSecs: 9999,
                    durationSecs: 180,
                    lastTrackChangeAt: 0,
                    now: 2.0
                )
                return d == .accept
            },
            Case(name: "decidePosition: inside window, position > freshTrackMaxPosition → drop") {
                // Old track was 200 s in; bridge leaks the stale timestamp.
                // 200 > 5 (freshTrackMaxPosition) → drop.
                let d = TrackChangeGuard.decidePosition(
                    positionSecs: 200,
                    durationSecs: 180,
                    lastTrackChangeAt: 0,
                    now: 0.5
                )
                return d == .drop
            },
            Case(name: "decidePosition: inside window, position > duration → drop") {
                // Position 6 s, duration 4 s. Even though position is
                // > freshTrackMaxPosition (5) too, this case asserts the
                // duration filter independently — drop applies.
                let d = TrackChangeGuard.decidePosition(
                    positionSecs: 6,
                    durationSecs: 4,
                    lastTrackChangeAt: 0,
                    now: 0.5
                )
                return d == .drop
            },
            Case(name: "decidePosition: inside window, in-range position → accept") {
                let d = TrackChangeGuard.decidePosition(
                    positionSecs: 0.3,
                    durationSecs: 180,
                    lastTrackChangeAt: 0,
                    now: 0.5
                )
                return d == .accept
            },
            Case(name: "decidePosition: inside window, duration nil → freshTrackMax filter still applies") {
                // No duration available (track metadata not yet loaded).
                // Position 7 > 5 freshTrackMax → drop.
                let d = TrackChangeGuard.decidePosition(
                    positionSecs: 7,
                    durationSecs: nil,
                    lastTrackChangeAt: 0,
                    now: 0.5
                )
                return d == .drop
            },
            Case(name: "decidePosition: window boundary (now == lastTrackChangeAt + window) → accept") {
                // Strictly less-than per the TS code. At exactly 1.5 s elapsed
                // the window has expired; outside-window path applies.
                let d = TrackChangeGuard.decidePosition(
                    positionSecs: 9999,
                    durationSecs: 180,
                    lastTrackChangeAt: 0,
                    now: TrackChangeGuard.reconcileWindow
                )
                return d == .accept
            },
            Case(name: "decidePosition: duration is 0 (unknown) → only freshTrackMax filter applies") {
                // duration > 0 guard means duration == 0 disables filter 2,
                // but filter 1 still drops large stragglers.
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
                return allowed == .accept && dropped == .drop
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
