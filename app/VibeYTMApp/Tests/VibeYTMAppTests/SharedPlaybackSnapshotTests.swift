import Foundation
import Testing
import PlayerCore
@testable import VibeYTMApp

/// Tests for SharedPlaybackSnapshot — the cross-process snapshot type
/// that future widgets / Control Center / AppIntents extensions read
/// from the App Group container.
///
/// Coverage: Codable round-trip, init from PlayerState, the pure
/// `shouldNotify` cadence decision function, throttle constants.
@MainActor
struct SharedPlaybackSnapshotTests {
    // MARK: - Codable

    @Test("Snapshot Codable round-trip preserves all fields")
    func codableRoundTripPreservesFields() throws {
        let track = Track(
            videoId: "dQw4w9WgXcQ",
            title: "Never Gonna Give You Up",
            artist: "Rick Astley",
            album: "Whenever You Need Somebody",
            artworkUrl: "https://example.com/cover.jpg",
            durationSecs: 213
        )
        let state = PlayerState(
            status: .playing,
            track: track,
            positionSecs: 42.5,
            volume: 0.8,
            isLiked: true
        )
        let snapshot = SharedPlaybackSnapshot(state: state)
        let encoded = try JSONEncoder().encode(snapshot)
        let decoded = try JSONDecoder().decode(SharedPlaybackSnapshot.self, from: encoded)

        #expect(decoded.videoId == "dQw4w9WgXcQ")
        #expect(decoded.title == "Never Gonna Give You Up")
        #expect(decoded.artist == "Rick Astley")
        #expect(decoded.album == "Whenever You Need Somebody")
        #expect(decoded.durationSecs == 213)
        #expect(decoded.positionSecs == 42.5)
        #expect(decoded.status == "playing")
        #expect(decoded.artworkUrl == "https://example.com/cover.jpg")
    }

    @Test("Snapshot from nil track has empty strings + zero duration")
    func snapshotFromNilTrack() {
        let state = PlayerState(status: .idle, track: nil)
        let snapshot = SharedPlaybackSnapshot(state: state)
        #expect(snapshot.videoId == nil)
        #expect(snapshot.title == "")
        #expect(snapshot.artist == "")
        #expect(snapshot.durationSecs == 0)
        #expect(snapshot.status == "idle")
    }

    // MARK: - shouldNotify cadence

    @Test("shouldNotify returns true on videoId change")
    func shouldNotifyOnVideoIdChange() {
        let snapshot = SharedPlaybackSnapshot(
            state: PlayerState(track: makeTrack(id: "new"))
        )
        let result = SharedPlaybackSnapshotWriter.shouldNotify(
            snapshot: snapshot,
            lastVideoId: "old",
            lastStatus: "playing",
            pollsSinceLastNotify: 0
        )
        #expect(result == true)
    }

    @Test("shouldNotify returns true on status change")
    func shouldNotifyOnStatusChange() {
        let snapshot = SharedPlaybackSnapshot(
            state: PlayerState(status: .paused, track: makeTrack(id: "x"))
        )
        let result = SharedPlaybackSnapshotWriter.shouldNotify(
            snapshot: snapshot,
            lastVideoId: "x",
            lastStatus: "playing",
            pollsSinceLastNotify: 0
        )
        #expect(result == true)
    }

    @Test("shouldNotify returns false when nothing changed within throttle window")
    func shouldNotifyFalseWithinWindow() {
        let snapshot = SharedPlaybackSnapshot(
            state: PlayerState(status: .playing, track: makeTrack(id: "x"))
        )
        let result = SharedPlaybackSnapshotWriter.shouldNotify(
            snapshot: snapshot,
            lastVideoId: "x",
            lastStatus: "playing",
            pollsSinceLastNotify: 5  // < 20
        )
        #expect(result == false)
    }

    @Test("shouldNotify returns true when reaching notifyEveryNPolls threshold")
    func shouldNotifyOnPollThreshold() {
        let snapshot = SharedPlaybackSnapshot(
            state: PlayerState(status: .playing, track: makeTrack(id: "x"))
        )
        let result = SharedPlaybackSnapshotWriter.shouldNotify(
            snapshot: snapshot,
            lastVideoId: "x",
            lastStatus: "playing",
            pollsSinceLastNotify: SharedPlaybackSnapshotConstants.notifyEveryNPolls
        )
        #expect(result == true)
    }

    // MARK: - Constants

    @Test("notifyEveryNPolls is 20 (3s at 150ms poll cadence)")
    func notifyEveryNPollsValue() {
        #expect(SharedPlaybackSnapshotConstants.notifyEveryNPolls == 20)
    }

    @Test("widgetReloadThrottleMs is 2000 (per design D10)")
    func widgetReloadThrottleValue() {
        #expect(SharedPlaybackSnapshotConstants.widgetReloadThrottleMs == 2000)
    }

    @Test("App Group identifier matches expected")
    func appGroupIdentifier() {
        #expect(SharedPlaybackSnapshotConstants.appGroup == "group.com.vibeytm.dev")
    }

    @Test("Darwin notification name matches expected")
    func notificationName() {
        #expect(SharedPlaybackSnapshotConstants.notificationName == "com.vibeytm.dev.snapshot-updated")
    }

    // MARK: - Helpers

    private func makeTrack(id: String) -> Track {
        Track(videoId: id, title: "Test", artist: "Artist", album: "", durationSecs: 100)
    }
}
