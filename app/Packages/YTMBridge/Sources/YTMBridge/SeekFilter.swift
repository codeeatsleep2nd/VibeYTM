import Foundation

// Pure logic for the POSITION_UPDATED echo filter. Ported from
// src/hooks/seekFilter.ts on the React/Tauri side.
//
// The filter exists to defend against a class of bug that has bitten the
// upstream codebase three times — see issues #41, #57, and the post-fix
// lyric-off-sync after progress-bar click that prompted the min-hold layer.
// Right after a manual seek, the YTM bridge fires a BURST of POSITION_UPDATED
// events as YTM's internal `<video>.currentTime` settles to the new
// position. The burst can include both:
//   • near-target readings (the seek landed)
//   • stale far-from-target readings (a delayed read that captured the
//     old position from before YTM moved)
// arriving in any order, separated by ~50–500 ms. Letting any far-from-
// target reading through after an on-target sighting snapped the smoothed
// position backward and scrolled the lyric panel to the wrong line.
//
// Time unit note: the TypeScript original used seconds for `position` and
// `target` but milliseconds for `now`, `lastSeekAt`, and `windowMs`. This
// Swift port normalizes everything to `TimeInterval` (seconds) — the native
// Foundation/AppKit unit — so the bridge layer can pass `Date.timeIntervalSince*`
// values directly without conversion. `MIN_HOLD_MS = 1500` becomes
// `minHold = 1.5`.

/// Filter state carried between successive POSITION_UPDATED events.
public struct SeekFilterState: Sendable, Equatable {
    /// True between `markSeek()` and the moment the seek has fully settled —
    /// meaning (a) a near-target reading has been observed AND (b) `minHold`
    /// has elapsed since `lastSeekAt`.
    public var pending: Bool

    /// Wall-clock time when the user-initiated seek fired, in seconds since
    /// some shared reference epoch (typically `Date.timeIntervalSinceReferenceDate`).
    public var lastSeekAt: TimeInterval

    /// Position the user seeked to, in seconds.
    public var target: TimeInterval

    public init(
        pending: Bool = false,
        lastSeekAt: TimeInterval = 0,
        target: TimeInterval = 0
    ) {
        self.pending = pending
        self.lastSeekAt = lastSeekAt
        self.target = target
    }
}

/// Outcome of a single filter decision.
public enum SeekFilterDecision: Sendable, Equatable {
    /// Pass the event through. `nextPending` is the state.pending value the
    /// caller should write back.
    case accept(nextPending: Bool)

    /// Drop the event entirely. `state.pending` stays as it was.
    case drop
}

public enum SeekFilter {
    /// Minimum window after `markSeek()` during which `pending` stays true
    /// even after a near-target event has been observed. Late stragglers
    /// (stale pre-seek readings arriving 100–500 ms after the bridge first
    /// reports the new position) are still dropped. Long enough to cover the
    /// bridge's full post-seek burst on a slow webview, short enough that
    /// follow-up user interactions aren't gated.
    public static let minHold: TimeInterval = 1.5

    /// Decide whether to accept or drop a POSITION_UPDATED event.
    ///
    /// Behaviour:
    ///   • Not pending → accept everything.
    ///   • Pending, far from target, within `windowSecs` → drop (stale echo).
    ///   • Pending, far from target, beyond `windowSecs` → accept and clear
    ///     pending (hard-cap fail-safe so a YTM stall can't freeze the UI).
    ///   • Pending, on target, before `minHold` → accept the value but KEEP
    ///     pending so subsequent stragglers from the same burst stay filtered.
    ///   • Pending, on target, after `minHold` → accept and clear pending
    ///     (the burst has had time to flush).
    public static func decide(
        state: SeekFilterState,
        positionSecs: TimeInterval,
        now: TimeInterval,
        toleranceSecs: TimeInterval,
        windowSecs: TimeInterval
    ) -> SeekFilterDecision {
        guard state.pending else {
            return .accept(nextPending: false)
        }
        let onTarget = abs(positionSecs - state.target) <= toleranceSecs
        let elapsed = now - state.lastSeekAt
        if !onTarget {
            if elapsed < windowSecs {
                return .drop
            }
            return .accept(nextPending: false)
        }
        if elapsed < minHold {
            return .accept(nextPending: true)
        }
        return .accept(nextPending: false)
    }
}
