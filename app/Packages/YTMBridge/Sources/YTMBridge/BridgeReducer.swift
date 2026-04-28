import Foundation
import PlayerCore

/// Pipeline state carried between successive bridge poll cycles. Holds
/// every filter's per-cycle memory in one place so the reducer can stay
/// pure (no shared mutable globals like `usePlayerState.ts` had).
public struct BridgePipelineState: Sendable, Equatable {
    public var seekFilter: SeekFilterState
    public var volumeSettle: VolumeSettleState
    /// Wall-clock time of the most recent real (videoId-changing) track
    /// change. Used by `TrackChangeGuard.decidePosition` to gate stale
    /// position-update echoes during the reconcile window.
    public var lastTrackChangeAt: TimeInterval

    public init(
        seekFilter: SeekFilterState = SeekFilterState(),
        volumeSettle: VolumeSettleState = VolumeSettleState(),
        lastTrackChangeAt: TimeInterval = -.infinity
    ) {
        self.seekFilter = seekFilter
        self.volumeSettle = volumeSettle
        self.lastTrackChangeAt = lastTrackChangeAt
    }
}

/// One step of the bridge → state pipeline. Pure function. Inputs are the
/// previous PlayerState, the previous pipeline state, the freshly decoded
/// BridgeState, the user's last-pushed volume (for VolumeSettle), and the
/// current wall-clock time. Outputs are the next PlayerState and the next
/// pipeline state. No I/O, no logging, no globals — every WKWebView quirk
/// caught by the filter modules is enforced here, in order.
///
/// Pipeline order matters:
///   1. Track-change handling (videoId equality) — produces the
///      `isSameTrack` signal and the rearm-window flag.
///   2. Position filtering — drop stragglers from the previous track that
///      leak through during the reconcile window.
///   3. Seek echo filtering — drop stale pre-seek positions during the
///      seek-pending window.
///   4. Volume reconcile — within `pushSettle`, prefer the user's last
///      pushed value over what the bridge reports.
///   5. Map remaining BridgeState fields onto PlayerState (title, artist,
///      artwork, status, repeat, shuffle, like, duration).
///
/// User IPC paths (markSeek, set_volume) feed into seekFilter / volume
/// settle by mutating the pipeline state OUTSIDE this reducer — those
/// mutations land in a follow-up batch.
public enum BridgeReducer {
    public struct Output: Sendable, Equatable {
        public let nextPlayerState: PlayerState
        public let nextPipeline: BridgePipelineState

        public init(nextPlayerState: PlayerState, nextPipeline: BridgePipelineState) {
            self.nextPlayerState = nextPlayerState
            self.nextPipeline = nextPipeline
        }
    }

    public static func reduce(
        previousPlayerState: PlayerState,
        previousPipeline: BridgePipelineState,
        bridge: BridgeState,
        storedVolume: Double,
        now: TimeInterval
    ) -> Output {
        // ---- Step 1: track change ----
        // Only arm the reconcile window when there's an incoming track.
        // The reducer is invoked every 150 ms — without the hasTrack
        // guard, every idle no-track cycle would re-arm the window and
        // gate every position update for 1.5 s, even though nothing
        // changed. (The TS handler ran only on TRACK_CHANGED events from
        // the bridge, so it never saw the empty case.)
        var pipeline = previousPipeline
        let trackChange: TrackChangeGuard.TrackChangeDecision
        if bridge.hasTrack {
            trackChange = TrackChangeGuard.decideTrackChanged(
                previousVideoId: previousPlayerState.track?.videoId,
                previousPositionSecs: previousPlayerState.positionSecs,
                incomingVideoId: bridge.videoId
            )
            if trackChange.armReconcileWindow {
                pipeline.lastTrackChangeAt = now
            }
        } else {
            // No track yet — synthesize a same-track decision so downstream
            // steps see a stable "nothing changed" signal.
            trackChange = TrackChangeGuard.TrackChangeDecision(
                isSameTrack: true,
                armReconcileWindow: false,
                nextPositionSecs: previousPlayerState.positionSecs
            )
        }

        // ---- Step 2: position filter (track-change reconcile window) ----
        let positionDuringReconcile = TrackChangeGuard.decidePosition(
            positionSecs: bridge.positionSecs,
            durationSecs: bridge.durationSecs > 0 ? bridge.durationSecs : nil,
            lastTrackChangeAt: pipeline.lastTrackChangeAt,
            now: now
        )

        // ---- Step 3: seek-echo filter ----
        // SeekFilter only acts when a markSeek() has armed the pending
        // flag; in default state (pending=false) every position passes
        // through. Callers writing into pipeline.seekFilter from a
        // markSeek() IPC will re-engage the filter automatically.
        let seekDecision = SeekFilter.decide(
            state: pipeline.seekFilter,
            positionSecs: bridge.positionSecs,
            now: now,
            toleranceSecs: 2,
            windowSecs: 5
        )

        // Combine the two filters: the position is accepted only if BOTH
        // the post-track-change reconcile and the seek-echo filter accept
        // it. If either drops, we keep the previous position.
        let acceptedPosition: Double = {
            switch (positionDuringReconcile, seekDecision) {
            case (.drop, _), (_, .drop):
                return previousPlayerState.positionSecs
            case (.accept, .accept):
                // Even when accepting, on a real track change we reset
                // to 0 (the TS handler does this in TRACK_CHANGED, not
                // POSITION_UPDATED — same outcome).
                return trackChange.isSameTrack
                    ? bridge.positionSecs
                    : trackChange.nextPositionSecs
            }
        }()
        switch seekDecision {
        case .accept(let nextPending):
            pipeline.seekFilter.pending = nextPending
        case .drop:
            // pending stays as-is
            break
        }

        // ---- Step 4: volume reconcile ----
        let volumeOutcome = VolumeSettle.decide(
            state: pipeline.volumeSettle,
            storedVolume: storedVolume,
            reportedVolume: bridge.volume,
            trackChanged: trackChange.armReconcileWindow,
            now: now
        )
        pipeline.volumeSettle.lastEmitted = volumeOutcome.nextLastEmitted

        // ---- Step 5: assemble next PlayerState ----
        let track: Track? = bridge.hasTrack ? Track(
            videoId: bridge.videoId,
            title: bridge.title,
            artist: bridge.artist,
            artistId: nil,
            album: bridge.album,
            albumId: nil,
            artworkUrl: bridge.artworkUrl.isEmpty ? nil : bridge.artworkUrl,
            durationSecs: bridge.durationSecs
        ) : nil

        let next = PlayerState(
            status: bridge.status,
            track: track,
            positionSecs: acceptedPosition,
            volume: volumeOutcome.effective,
            isLiked: bridge.isLiked,
            repeatMode: bridge.repeatMode,
            isShuffled: bridge.isShuffled,
            queue: bridge.queue.isEmpty ? previousPlayerState.queue : bridge.queue,
            activePlaylistId: previousPlayerState.activePlaylistId,
            account: previousPlayerState.account,
            loggedIn: previousPlayerState.loggedIn,
            pendingRestore: previousPlayerState.pendingRestore
        )

        return Output(nextPlayerState: next, nextPipeline: pipeline)
    }
}
