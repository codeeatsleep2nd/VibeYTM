import Foundation

// Pure logic for the post-push volume reconcile window. Ported from
// `src-tauri/src/webview_bridge/poller.rs` (the `VOLUME_PUSH_SETTLE_MS`
// branch around line 540) on the Tauri/Rust side. Defends issue #76 — the
// volume slider snapping to MAX after a track change because YTM's fresh
// `<video>` element transiently reports its default 1.0 before our
// `set_volume` push lands.
//
// Two halves protect against the regression and BOTH must stay in place:
//
//   1. When the bridge reports a volume that disagrees with what we last
//      pushed by more than `disagreementThreshold`, AND we're either inside
//      the push-settle window OR the track just changed, trust the stored
//      (pushed) value over the bridge's reported value.
//
//   2. Only emit `player:volume` when the effective volume actually changes
//      (>`emitThreshold`). Per-cycle emission of an identical value lets
//      stale 1.0 readings sail through the frontend's echo window.
//
// Removing either half re-opens the bug — track changes 1200–2000 ms after
// the last user adjustment hit the gap. See CLAUDE.md "WKWebView quirks"
// for the full root-cause writeup.

/// State carried between successive poller cycles for the volume filter.
public struct VolumeSettleState: Sendable, Equatable {
    /// The last value we emitted to the frontend, or nil if we have not yet
    /// emitted anything since the poller started.
    public var lastEmitted: Double?

    /// Wall-clock time of the last `set_volume` push to the bridge (user
    /// IPC OR the bridge-just-loaded re-seed), in seconds since some shared
    /// reference epoch. nil before any push has occurred.
    public var lastPushAt: TimeInterval?

    public init(lastEmitted: Double? = nil, lastPushAt: TimeInterval? = nil) {
        self.lastEmitted = lastEmitted
        self.lastPushAt = lastPushAt
    }
}

/// Outcome of one filter cycle. Caller should use `effective` as the
/// authoritative volume, then if `shouldEmit` is true, fire the
/// `player:volume` event with that value and write `nextLastEmitted` back
/// into state.
public struct VolumeSettleDecision: Sendable, Equatable {
    public let effective: Double
    public let shouldEmit: Bool
    public let nextLastEmitted: Double?
    /// True iff `effective` came from the stored (pushed) value rather than
    /// the bridge's reported value — i.e. the override fired.
    public let usedStored: Bool

    public init(
        effective: Double,
        shouldEmit: Bool,
        nextLastEmitted: Double?,
        usedStored: Bool
    ) {
        self.effective = effective
        self.shouldEmit = shouldEmit
        self.nextLastEmitted = nextLastEmitted
        self.usedStored = usedStored
    }
}

public enum VolumeSettle {
    /// How long after a `set_volume` push we keep trusting the stored value
    /// over the bridge's reported value when they disagree. 2 s covers the
    /// 1–2 poll cycles (~150 ms each) of bridge lag plus some safety
    /// margin for slow webview reloads.
    public static let pushSettle: TimeInterval = 2.0

    /// Minimum disagreement between stored and reported volume that
    /// triggers the override. Below this we accept the bridge's value
    /// even within the settle window — small floating-point drift on
    /// the YTM side shouldn't cause the slider to snap.
    public static let disagreementThreshold: Double = 0.01

    /// Minimum delta between successive effective volumes that triggers
    /// an emit. Below this we suppress emission entirely. Catches the
    /// per-cycle stale-value spam that issue #76 exploited.
    public static let emitThreshold: Double = 0.001

    /// Run one cycle of the filter.
    ///
    /// - Parameters:
    ///   - state: prior state (lastEmitted, lastPushAt). Pass freshly
    ///     allocated `VolumeSettleState()` on first call.
    ///   - storedVolume: the value we last pushed via `set_volume` (or the
    ///     persisted user setting if no push has occurred yet).
    ///   - reportedVolume: the value the bridge currently reports
    ///     (`bs.volume` on the Rust side).
    ///   - trackChanged: true iff this cycle is the one immediately after
    ///     a `videoId` change. Triggers the override unconditionally for
    ///     the disagreement case (the new `<video>` defaults to 1.0).
    ///   - now: current wall-clock time in seconds.
    public static func decide(
        state: VolumeSettleState,
        storedVolume: Double,
        reportedVolume: Double,
        trackChanged: Bool,
        now: TimeInterval
    ) -> VolumeSettleDecision {
        let withinPushSettle: Bool = {
            guard let last = state.lastPushAt else { return false }
            return (now - last) < pushSettle
        }()

        let disagreement = abs(reportedVolume - storedVolume) > disagreementThreshold
        let usedStored = (trackChanged || withinPushSettle) && disagreement
        let effective = usedStored ? storedVolume : reportedVolume

        let shouldEmit: Bool
        let nextLastEmitted: Double?
        if let last = state.lastEmitted {
            if abs(last - effective) > emitThreshold {
                shouldEmit = true
                nextLastEmitted = effective
            } else {
                shouldEmit = false
                nextLastEmitted = last
            }
        } else {
            // First emission since the poller started — always fire so the
            // frontend has an initial value.
            shouldEmit = true
            nextLastEmitted = effective
        }

        return VolumeSettleDecision(
            effective: effective,
            shouldEmit: shouldEmit,
            nextLastEmitted: nextLastEmitted,
            usedStored: usedStored
        )
    }
}
