import Foundation
import Testing
import PlayerCore
@testable import YTMBridge

// Mirrors Sources/BridgeReducerValidator/main.swift. Runs once Xcode 26
// is installed and Swift Testing's `_Testing_Foundation` swiftmodule is
// available. See app/README.md "Known toolchain quirks".

@Suite("BridgeReducer.reduce")
struct BridgeReducerTests {
    @Test("first cycle on cold start with no track → no rearm")
    func coldStartNoTrack() {
        let out = BridgeReducer.reduce(
            previousPlayerState: PlayerState(),
            previousPipeline: BridgePipelineState(),
            bridge: BridgeState(),
            storedVolume: 1.0,
            now: 10.0
        )
        #expect(out.nextPlayerState.track == nil)
        #expect(out.nextPlayerState.status == .idle)
        #expect(out.nextPipeline.lastTrackChangeAt == -.infinity)
    }

    @Test("first real track → arms reconcile window, builds Track, position 0")
    func firstRealTrack() {
        let bridge = BridgeState(
            status: .playing,
            title: "T1",
            artist: "A1",
            videoId: "abc",
            positionSecs: 3.0,
            durationSecs: 180,
            volume: 0.5
        )
        let out = BridgeReducer.reduce(
            previousPlayerState: PlayerState(),
            previousPipeline: BridgePipelineState(),
            bridge: bridge,
            storedVolume: 0.5,
            now: 10.0
        )
        #expect(out.nextPlayerState.track?.videoId == "abc")
        #expect(out.nextPlayerState.track?.title == "T1")
        #expect(out.nextPlayerState.positionSecs == 0)
        #expect(out.nextPlayerState.status == .playing)
        #expect(out.nextPipeline.lastTrackChangeAt == 10.0)
    }

    @Test("stale large position from prev track is dropped during reconcile window")
    func dropStaleLargePosition() {
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
        #expect(out.nextPlayerState.positionSecs == 0)
    }

    @Test("same videoId with metadata refinement does NOT rearm window")
    func metadataRefinementNoRearm() {
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
        #expect(out.nextPlayerState.track?.title == "refined")
        #expect(out.nextPlayerState.positionSecs == 31.5)
        #expect(out.nextPipeline.lastTrackChangeAt == 10.0)
    }

    @Test("volume reconcile within push-settle prefers stored over reported")
    func volumeReconcile() {
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
                videoId: "xyz",
                positionSecs: 0,
                durationSecs: 180,
                volume: 1.0
            ),
            storedVolume: 0.3,
            now: 10.5
        )
        #expect(out.nextPlayerState.volume == 0.3)
    }

    @Test("steady state — bridge fields pass through")
    func steadyState() {
        let prev = PlayerState(
            track: Track(videoId: "abc", title: "T", artist: "A", album: "L", durationSecs: 180),
            positionSecs: 60
        )
        let pipeline = BridgePipelineState(lastTrackChangeAt: 0.0)
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
        #expect(out.nextPlayerState.positionSecs == 65)
        #expect(out.nextPlayerState.volume == 0.7)
        #expect(out.nextPlayerState.isShuffled)
        #expect(out.nextPlayerState.repeatMode == .one)
        #expect(out.nextPlayerState.isLiked)
    }

    @Test("loggedIn is preserved across reducer cycles")
    func loggedInPreserved() {
        let prev = PlayerState(loggedIn: true)
        let out = BridgeReducer.reduce(
            previousPlayerState: prev,
            previousPipeline: BridgePipelineState(),
            bridge: BridgeState(),
            storedVolume: 1.0,
            now: 10.0
        )
        #expect(out.nextPlayerState.loggedIn == true)
    }

    @Test("BridgeState decodes from JSON identical to inject-script payload")
    func decodeInjectPayload() throws {
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
        let s = try JSONDecoder().decode(BridgeState.self, from: json)
        #expect(s.status == .playing)
        #expect(s.title == "Hello")
        #expect(s.videoId == "abc123")
        #expect(s.positionSecs == 42.5)
        #expect(s.repeatMode == .all)
        #expect(s.isShuffled)
    }

    @Test("BridgeState tolerates missing fields (partial payload)")
    func decodePartialPayload() throws {
        let json = "{ \"status\": \"buffering\" }".data(using: .utf8)!
        let s = try JSONDecoder().decode(BridgeState.self, from: json)
        #expect(s.status == .buffering)
        #expect(s.title == "")
        #expect(s.videoId == "")
        #expect(s.volume == 1.0)
        #expect(s.repeatMode == .none)
    }
}
