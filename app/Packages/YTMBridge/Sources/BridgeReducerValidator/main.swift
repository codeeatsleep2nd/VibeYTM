import Foundation
import PlayerCore
import YTMBridge

// CLT-only proxy for Tests/YTMBridgeTests/BridgeReducerTests.swift. Same
// rationale as the other validators — `import Testing` fails on Command
// Line Tools 6.2 because `_Testing_Foundation.framework` ships without a
// swiftmodule. Delete this target once Xcode 26 is installed.

@main
struct Main {
    static func main() {
        struct Case {
            let name: String
            let body: () -> Bool
        }

        let cases: [Case] = [
            Case(name: "first cycle on cold start with no track → empty next state, no rearm") {
                let out = BridgeReducer.reduce(
                    previousPlayerState: PlayerState(),
                    previousPipeline: BridgePipelineState(),
                    bridge: BridgeState(),  // empty videoId → no track
                    storedVolume: 1.0,
                    now: 10.0
                )
                return out.nextPlayerState.track == nil
                    && out.nextPlayerState.status == .idle
                    && out.nextPipeline.lastTrackChangeAt == -.infinity
            },

            Case(name: "first real track → arms reconcile window, builds Track, position 0") {
                let bridge = BridgeState(
                    status: .playing,
                    title: "T1",
                    artist: "A1",
                    videoId: "abc",
                    positionSecs: 3.0,  // outside fresh-track-max won't trigger drop because no prev track change armed... wait yes it will
                    durationSecs: 180,
                    volume: 0.5
                )
                // Within reconcile window 1.5s and pos 3 < freshTrackMax 5 → accept
                // But pos 3 != 0 (incoming says 3). Reducer resets to 0
                // because of trackChange.nextPositionSecs (real change).
                let out = BridgeReducer.reduce(
                    previousPlayerState: PlayerState(),
                    previousPipeline: BridgePipelineState(),
                    bridge: bridge,
                    storedVolume: 0.5,
                    now: 10.0
                )
                return out.nextPlayerState.track?.videoId == "abc"
                    && out.nextPlayerState.track?.title == "T1"
                    && out.nextPlayerState.positionSecs == 0
                    && out.nextPlayerState.status == .playing
                    && out.nextPipeline.lastTrackChangeAt == 10.0
            },

            Case(name: "stale large position from prev track is dropped during reconcile window") {
                // Track change happened at t=10. Bridge cycle at t=10.5
                // still reports positionSecs=200 from the previous track.
                // Window is 1.5s; 200 > freshTrackMax (5) → drop, keep
                // previous PlayerState position (which was just reset to 0).
                let prev = PlayerState(
                    track: Track(videoId: "abc", title: "T", artist: "A", album: "L", durationSecs: 180),
                    positionSecs: 0
                )
                let pipeline = BridgePipelineState(lastTrackChangeAt: 10.0)
                let out = BridgeReducer.reduce(
                    previousPlayerState: prev,
                    previousPipeline: pipeline,
                    bridge: BridgeState(
                        status: .playing,
                        title: "T",
                        artist: "A",
                        videoId: "abc",
                        positionSecs: 200,
                        durationSecs: 180
                    ),
                    storedVolume: 1.0,
                    now: 10.5
                )
                return out.nextPlayerState.positionSecs == 0
            },

            Case(name: "same videoId with metadata refinement does NOT rearm window") {
                // Cycle 1 at t=10 set lastTrackChangeAt=10, track=abc.
                // Cycle 2 at t=12 (past 1.5s reconcile window) sees same
                // videoId but refined title. Window must NOT rearm —
                // otherwise stale position drops for another 1.5s would
                // discard valid post-refinement positions. We pick now=12
                // to put the cycle outside the existing reconcile window
                // so the position filter passes; the assertion is about
                // lastTrackChangeAt, not position drop semantics.
                let prev = PlayerState(
                    track: Track(videoId: "abc", title: "old", artist: "A", album: "L", durationSecs: 180),
                    positionSecs: 30
                )
                let pipeline = BridgePipelineState(lastTrackChangeAt: 10.0)
                let out = BridgeReducer.reduce(
                    previousPlayerState: prev,
                    previousPipeline: pipeline,
                    bridge: BridgeState(
                        status: .playing,
                        title: "refined",
                        artist: "A",
                        videoId: "abc",
                        positionSecs: 31.5,
                        durationSecs: 180
                    ),
                    storedVolume: 1.0,
                    now: 12.0
                )
                return out.nextPlayerState.track?.title == "refined"
                    && out.nextPlayerState.positionSecs == 31.5
                    && out.nextPipeline.lastTrackChangeAt == 10.0
            },

            Case(name: "volume reconcile within push-settle prefers stored over reported") {
                // User pushed 0.3 at t=10. Track change at t=10.4. Bridge
                // cycle at t=10.5 reports 1.0 (fresh <video>'s default).
                // VolumeSettle.pushSettle = 2.0s; track-changed cycle is
                // also a trust window. Stored 0.3 wins.
                let prev = PlayerState(
                    track: Track(videoId: "abc", title: "T", artist: "A", album: "L", durationSecs: 180),
                    positionSecs: 0,
                    volume: 0.3
                )
                let pipeline = BridgePipelineState(
                    volumeSettle: VolumeSettleState(lastEmitted: 0.3, lastPushAt: 10.0),
                    lastTrackChangeAt: -.infinity
                )
                let out = BridgeReducer.reduce(
                    previousPlayerState: prev,
                    previousPipeline: pipeline,
                    bridge: BridgeState(
                        status: .playing,
                        title: "T",
                        artist: "A",
                        videoId: "xyz",  // new track, triggers track change
                        positionSecs: 0,
                        durationSecs: 180,
                        volume: 1.0
                    ),
                    storedVolume: 0.3,
                    now: 10.5
                )
                return out.nextPlayerState.volume == 0.3
            },

            Case(name: "no track change, no seek pending, no volume push → bridge fields pass through") {
                // Steady-state cycle 5 s after track change; everything
                // accepts as-is.
                let prev = PlayerState(
                    track: Track(videoId: "abc", title: "T", artist: "A", album: "L", durationSecs: 180),
                    positionSecs: 60
                )
                let pipeline = BridgePipelineState(lastTrackChangeAt: 0.0)  // 5s ago
                let out = BridgeReducer.reduce(
                    previousPlayerState: prev,
                    previousPipeline: pipeline,
                    bridge: BridgeState(
                        status: .playing,
                        title: "T",
                        artist: "A",
                        videoId: "abc",
                        positionSecs: 65,
                        durationSecs: 180,
                        volume: 0.7,
                        isShuffled: true,
                        repeatMode: .one,
                        isLiked: true
                    ),
                    storedVolume: 0.7,
                    now: 5.0
                )
                return out.nextPlayerState.positionSecs == 65
                    && out.nextPlayerState.volume == 0.7
                    && out.nextPlayerState.isShuffled == true
                    && out.nextPlayerState.repeatMode == .one
                    && out.nextPlayerState.isLiked == true
            },

            Case(name: "loggedIn from previous state is preserved across reducer cycles") {
                // Reducer doesn't touch loggedIn — that channel comes
                // from BridgeHost separately (it lives on a different JS
                // global). Make sure the reducer doesn't clobber it.
                let prev = PlayerState(loggedIn: true)
                let out = BridgeReducer.reduce(
                    previousPlayerState: prev,
                    previousPipeline: BridgePipelineState(),
                    bridge: BridgeState(),
                    storedVolume: 1.0,
                    now: 10.0
                )
                return out.nextPlayerState.loggedIn == true
            },

            Case(name: "BridgeState decodes from JSON identical to inject-script payload") {
                let json = """
                {
                  "status": "playing",
                  "title": "Hello",
                  "artist": "World",
                  "album": "",
                  "artworkUrl": "https://x.test/a.jpg",
                  "videoId": "abc123",
                  "positionSecs": 42.5,
                  "durationSecs": 180.3,
                  "volume": 0.55,
                  "isShuffled": true,
                  "repeatMode": "all",
                  "isLiked": false
                }
                """.data(using: .utf8)!
                guard let s = try? JSONDecoder().decode(BridgeState.self, from: json) else {
                    return false
                }
                return s.status == .playing && s.title == "Hello"
                    && s.videoId == "abc123" && s.positionSecs == 42.5
                    && s.repeatMode == .all && s.isShuffled == true
            },

            Case(name: "BridgeState tolerates missing fields (partial payload)") {
                // The inject script may emit a partial state during page
                // transitions. Decoder must default rather than throw.
                let json = "{ \"status\": \"buffering\" }".data(using: .utf8)!
                guard let s = try? JSONDecoder().decode(BridgeState.self, from: json) else {
                    return false
                }
                return s.status == .buffering && s.title == "" && s.videoId == ""
                    && s.volume == 1.0 && s.repeatMode == .none
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
