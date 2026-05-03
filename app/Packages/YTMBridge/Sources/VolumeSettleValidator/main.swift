import Foundation
import YTMBridge

// CLT-only proxy for Tests/YTMBridgeTests/VolumeSettleTests.swift. Same
// rationale as SeekFilterValidator — `import Testing` fails on Command Line
// Tools 6.2 because Apple ships `_Testing_Foundation.framework` without
// a swiftmodule. Delete this target once Xcode 26 is installed.

@main
struct Main {
    static func main() {
        struct Case {
            let name: String
            let body: () -> Bool
        }

        let cases: [Case] = [
            Case(name: "first cycle ever — accepts reported and emits") {
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(),
                    storedVolume: 0.5,
                    reportedVolume: 0.5,
                    trackChanged: false,
                    now: 10.0
                )
                return d.effective == 0.5 && d.shouldEmit && d.usedStored == false
                    && d.nextLastEmitted == 0.5
            },
            Case(name: "no push, no track change → reported wins regardless of disagreement") {
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(lastEmitted: 0.5, lastPushAt: nil),
                    storedVolume: 0.3,
                    reportedVolume: 0.6,
                    trackChanged: false,
                    now: 10.0
                )
                return d.effective == 0.6 && d.usedStored == false && d.shouldEmit
            },
            Case(name: "within push-settle window with disagreement → stored wins (issue #76)") {
                // The exact regression: user set volume to 0.3 at t=10, page
                // navigates at t=10.5, fresh <video> reports 1.0 at t=10.6.
                // Before the fix this 1.0 sailed through. Now: stored wins.
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: 10.0),
                    storedVolume: 0.3,
                    reportedVolume: 1.0,
                    trackChanged: false,
                    now: 10.6
                )
                return d.effective == 0.3 && d.usedStored && d.shouldEmit == false
            },
            Case(name: "within push-settle but agreement (within 0.01) → reported wins, no emit") {
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: 10.0),
                    storedVolume: 0.3,
                    reportedVolume: 0.305,
                    trackChanged: false,
                    now: 10.5
                )
                // 0.305 - 0.3 = 0.005, below disagreementThreshold (0.01).
                // No override; reported flows through. Last emitted was 0.3,
                // delta 0.005 > emitThreshold (0.001), so we DO emit.
                return d.effective == 0.305 && d.usedStored == false && d.shouldEmit
            },
            Case(name: "after push-settle expires → reported wins even with disagreement") {
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: 10.0),
                    storedVolume: 0.3,
                    reportedVolume: 1.0,
                    trackChanged: false,
                    now: 12.5  // 2.5 s past push, beyond pushSettle (2.0 s)
                )
                return d.effective == 1.0 && d.usedStored == false && d.shouldEmit
            },
            Case(name: "track change with disagreement → stored wins regardless of push-settle") {
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: nil),
                    storedVolume: 0.3,
                    reportedVolume: 1.0,
                    trackChanged: true,
                    now: 100.0
                )
                return d.effective == 0.3 && d.usedStored && d.shouldEmit == false
            },
            Case(name: "identical successive emissions are gated") {
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(lastEmitted: 0.5, lastPushAt: nil),
                    storedVolume: 0.5,
                    reportedVolume: 0.5,
                    trackChanged: false,
                    now: 10.0
                )
                return d.effective == 0.5 && d.shouldEmit == false
                    && d.nextLastEmitted == 0.5
            },
            Case(name: "tiny change below emit threshold suppresses emission") {
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(lastEmitted: 0.5, lastPushAt: nil),
                    storedVolume: 0.5,
                    reportedVolume: 0.5005,  // delta 0.0005 < emitThreshold (0.001)
                    trackChanged: false,
                    now: 10.0
                )
                return d.effective == 0.5005 && d.shouldEmit == false
                    && d.nextLastEmitted == 0.5  // unchanged
            },
            Case(name: "track change with agreement (within 0.01) → reported wins") {
                let d = VolumeSettle.decide(
                    state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: nil),
                    storedVolume: 0.3,
                    reportedVolume: 0.305,
                    trackChanged: true,
                    now: 100.0
                )
                return d.effective == 0.305 && d.usedStored == false
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
