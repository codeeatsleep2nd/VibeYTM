import Foundation

// Pure logic for the post-track-change reconcile window. Ported from
// `src/hooks/usePlayerState.ts` (the TRACK_CHANGED handler around line 121
// and the POSITION_UPDATED stale-track filter around line 196).
//
// Two distinct hazards live in the same window:
//
//   A. The bridge poller in `src-tauri/src/webview_bridge/poller.rs`
//      re-emits `player:track-changed` on metadata refinement (duration
//      grew, title/artist/artwork was refined) — not just on real
//      track-change. Treating every emit as a real change arms the
//      track-reconcile window 1.5 s after a metadata refinement, which
//      drops every legitimate POSITION_UPDATED inside that window — the
//      lyric panel ends up pinned to the pre-refinement position.
//      The `isSameTrack` (videoId equality) guard is what filters this.
//
//   B. After a genuine track change, the bridge poller may still report
//      the PREVIOUS track's elapsed timestamp for ~1 cycle until the new
//      `<video>` src settles. Two filters during the reconcile window
//      drop those stragglers:
//        1. position > FRESH_TRACK_MAX_POSITION_SECS (no fresh track has
//           advanced past 5 s yet — anything bigger is stale).
//        2. duration > 0 && position > duration (old track was longer).
//
// Constants intentionally match the React side so behavior is identical
// across the rewrite.

public enum TrackChangeGuard {
    /// Window after a real track change during which POSITION_UPDATED
    /// events are gated through `decidePosition`. Matches
    /// `TRACK_CHANGE_RECONCILE_WINDOW_MS = 1500` in `usePlayerState.ts`.
    public static let reconcileWindow: TimeInterval = 1.5

    /// Maximum position a freshly-changed track is allowed to report
    /// during the reconcile window. Anything larger is treated as the
    /// previous track's leftover timestamp leaking through. Matches
    /// `FRESH_TRACK_MAX_POSITION_SECS = 5` in `usePlayerState.ts`.
    public static let freshTrackMaxPosition: Double = 5

    // MARK: - Track change

    /// What `usePlayerState` does on each TRACK_CHANGED event.
    public struct TrackChangeDecision: Sendable, Equatable {
        /// True when the incoming videoId equals the previous videoId.
        /// Metadata refinement / session-restore re-emit. Caller should:
        ///   - keep the existing positionSecs (don't reset to 0)
        ///   - NOT update lastTrackChangeAt (don't arm the reconcile window)
        public let isSameTrack: Bool

        /// True when caller should write `now` into its lastTrackChangeAt
        /// state. Equivalent to `!isSameTrack`.
        public let armReconcileWindow: Bool

        /// The positionSecs the caller should write into state.
        /// On same-track this passes through the previous position; on a
        /// real change this resets to 0 so the progress bar doesn't briefly
        /// render the old position over the new (shorter) duration.
        public let nextPositionSecs: Double
    }

    public static func decideTrackChanged(
        previousVideoId: String?,
        previousPositionSecs: Double,
        incomingVideoId: String?
    ) -> TrackChangeDecision {
        // Both sides nil/empty would be unusual but matches the TS guard:
        // `!!prev.track && !!track && prev.track.videoId === track.videoId`.
        let isSameTrack: Bool = {
            guard let prev = previousVideoId, let inc = incomingVideoId else {
                return false
            }
            return prev == inc
        }()
        return TrackChangeDecision(
            isSameTrack: isSameTrack,
            armReconcileWindow: !isSameTrack,
            nextPositionSecs: isSameTrack ? previousPositionSecs : 0
        )
    }

    // MARK: - Position filter

    /// What `usePlayerState` does on each POSITION_UPDATED event ONCE the
    /// seek-echo filter has already accepted the event.
    public enum PositionDecision: Sendable, Equatable {
        /// Caller should write the new positionSecs into state.
        case accept

        /// Caller should drop the event entirely (stale).
        case drop
    }

    public static func decidePosition(
        positionSecs: Double,
        durationSecs: Double?,
        lastTrackChangeAt: TimeInterval,
        now: TimeInterval
    ) -> PositionDecision {
        // Outside the reconcile window — no special filtering.
        guard now - lastTrackChangeAt < reconcileWindow else {
            return .accept
        }
        // Filter 1: no fresh track has advanced past freshTrackMaxPosition.
        if positionSecs > freshTrackMaxPosition {
            return .drop
        }
        // Filter 2: position exceeds the new track's duration → stale.
        if let duration = durationSecs, duration > 0, positionSecs > duration {
            return .drop
        }
        return .accept
    }
}
