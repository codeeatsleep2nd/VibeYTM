import Foundation
import Testing
@testable import YTMBridge

// Mirrors Sources/VolumeSettleValidator/main.swift. Runs once Xcode 26 is
// installed and Swift Testing's `_Testing_Foundation` swiftmodule is
// available. See README "Known toolchain quirks".

@Suite("VolumeSettle.decide")
struct VolumeSettleTests {
    @Test("first cycle ever — accepts reported and emits")
    func firstCycleEmits() {
        let d = VolumeSettle.decide(
            state: VolumeSettleState(),
            storedVolume: 0.5,
            reportedVolume: 0.5,
            trackChanged: false,
            now: 10.0
        )
        #expect(d.effective == 0.5)
        #expect(d.shouldEmit)
        #expect(!d.usedStored)
        #expect(d.nextLastEmitted == 0.5)
    }

    @Test("no push, no track change — reported wins regardless of disagreement")
    func noPushNoTrackChangeReportedWins() {
        let d = VolumeSettle.decide(
            state: VolumeSettleState(lastEmitted: 0.5, lastPushAt: nil),
            storedVolume: 0.3,
            reportedVolume: 0.6,
            trackChanged: false,
            now: 10.0
        )
        #expect(d.effective == 0.6)
        #expect(!d.usedStored)
        #expect(d.shouldEmit)
    }

    @Test("within push-settle window with disagreement — stored wins (issue #76)")
    func withinPushSettleStoredWins() {
        // The exact regression: user set volume to 0.3 at t=10, page navigates
        // at t=10.5, fresh <video> reports 1.0 at t=10.6. Stored must win.
        let d = VolumeSettle.decide(
            state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: 10.0),
            storedVolume: 0.3,
            reportedVolume: 1.0,
            trackChanged: false,
            now: 10.6
        )
        #expect(d.effective == 0.3)
        #expect(d.usedStored)
        #expect(!d.shouldEmit)
    }

    @Test("within push-settle but agreement (within 0.01) — reported wins, emits")
    func withinPushSettleAgreementReportedWins() {
        let d = VolumeSettle.decide(
            state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: 10.0),
            storedVolume: 0.3,
            reportedVolume: 0.305,
            trackChanged: false,
            now: 10.5
        )
        #expect(d.effective == 0.305)
        #expect(!d.usedStored)
        #expect(d.shouldEmit)
    }

    @Test("after push-settle expires — reported wins even with disagreement")
    func afterPushSettleExpiresReportedWins() {
        let d = VolumeSettle.decide(
            state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: 10.0),
            storedVolume: 0.3,
            reportedVolume: 1.0,
            trackChanged: false,
            now: 12.5  // 2.5 s past push, beyond pushSettle (2.0 s)
        )
        #expect(d.effective == 1.0)
        #expect(!d.usedStored)
        #expect(d.shouldEmit)
    }

    @Test("track change with disagreement — stored wins regardless of push-settle")
    func trackChangeStoredWins() {
        let d = VolumeSettle.decide(
            state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: nil),
            storedVolume: 0.3,
            reportedVolume: 1.0,
            trackChanged: true,
            now: 100.0
        )
        #expect(d.effective == 0.3)
        #expect(d.usedStored)
        #expect(!d.shouldEmit)
    }

    @Test("identical successive emissions are gated")
    func identicalEmissionsGated() {
        let d = VolumeSettle.decide(
            state: VolumeSettleState(lastEmitted: 0.5, lastPushAt: nil),
            storedVolume: 0.5,
            reportedVolume: 0.5,
            trackChanged: false,
            now: 10.0
        )
        #expect(d.effective == 0.5)
        #expect(!d.shouldEmit)
        #expect(d.nextLastEmitted == 0.5)
    }

    @Test("tiny change below emit threshold suppresses emission")
    func subThresholdChangeSuppressed() {
        let d = VolumeSettle.decide(
            state: VolumeSettleState(lastEmitted: 0.5, lastPushAt: nil),
            storedVolume: 0.5,
            reportedVolume: 0.5005,  // delta 0.0005 < emitThreshold (0.001)
            trackChanged: false,
            now: 10.0
        )
        #expect(d.effective == 0.5005)
        #expect(!d.shouldEmit)
        #expect(d.nextLastEmitted == 0.5)
    }

    @Test("track change with agreement (within 0.01) — reported wins")
    func trackChangeAgreementReportedWins() {
        let d = VolumeSettle.decide(
            state: VolumeSettleState(lastEmitted: 0.3, lastPushAt: nil),
            storedVolume: 0.3,
            reportedVolume: 0.305,
            trackChanged: true,
            now: 100.0
        )
        #expect(d.effective == 0.305)
        #expect(!d.usedStored)
    }
}
