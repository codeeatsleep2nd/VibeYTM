import Foundation
import Testing
@testable import PlayerCore

// Mirrors Sources/PlayerCoreValidator/main.swift. Runs once Xcode 26 is
// installed and Swift Testing's `_Testing_Foundation` swiftmodule is
// available. See app/README.md "Known toolchain quirks".

@Suite("PlayerCore value types")
struct PlayerCoreTests {
    @Test("Account encodes with camelCase keys")
    func accountCamelCase() throws {
        let account = Account(name: "Jane", avatarUrl: "https://example.test/a.jpg")
        let data = try JSONEncoder().encode(account)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(json?["name"] as? String == "Jane")
        #expect(json?["avatarUrl"] as? String == "https://example.test/a.jpg")
        #expect(json?["avatar_url"] == nil)
    }

    @Test("Account equality enables change detection")
    func accountEquality() {
        let a = Account(name: "A", avatarUrl: "u")
        let b = Account(name: "A", avatarUrl: "u")
        let c = Account(name: "A", avatarUrl: "v")
        #expect(a == b)
        #expect(a != c)
    }

    @Test("PlayerState default has no account, idle, volume 1.0")
    func playerStateDefault() {
        let s = PlayerState()
        #expect(s.account == nil)
        #expect(s.status == .idle)
        #expect(s.volume == 1.0)
        #expect(s.repeatMode == .none)
        #expect(!s.isShuffled)
        #expect(s.queue.isEmpty)
        #expect(s.loggedIn == nil)
    }

    @Test("PlayerState serializes account when present")
    func playerStateSerializesAccount() throws {
        let s = PlayerState(account: Account(name: "Jane", avatarUrl: "u"))
        let data = try JSONEncoder().encode(s)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let acct = json?["account"] as? [String: Any]
        #expect(acct?["name"] as? String == "Jane")
    }

    @Test("PlayerState pendingRestore never appears in encoded JSON")
    func pendingRestoreSkipped() throws {
        let s = PlayerState(pendingRestore: PendingRestore(
            videoId: "abc", positionSecs: 42, playlistId: nil
        ))
        let data = try JSONEncoder().encode(s)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(json?["pendingRestore"] == nil)
        #expect(json?["pending_restore"] == nil)
    }

    @Test("PlaybackStatus encodes with raw lowercase string")
    func playbackStatusEncoding() throws {
        let data = try JSONEncoder().encode(PlaybackStatus.buffering)
        let s = String(data: data, encoding: .utf8)
        #expect(s == "\"buffering\"")
    }

    @Test("RepeatMode round-trips through JSON")
    func repeatModeRoundTrip() throws {
        let original: [RepeatMode] = [.none, .one, .all]
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode([RepeatMode].self, from: data)
        #expect(decoded == original)
    }

    @Test("Track Identifiable id is videoId")
    func trackIdentifiable() {
        let t = Track(
            videoId: "abc",
            title: "T",
            artist: "A",
            album: "L",
            durationSecs: 180
        )
        #expect(t.id == "abc")
    }

    @Test("PlayerState round-trips through JSON without pendingRestore")
    func playerStateRoundTrip() throws {
        let original = PlayerState(
            status: .playing,
            track: Track(
                videoId: "abc",
                title: "T",
                artist: "A",
                album: "L",
                artworkUrl: "https://x.test/a.jpg",
                durationSecs: 180
            ),
            positionSecs: 42,
            volume: 0.5,
            isLiked: true,
            repeatMode: .one,
            isShuffled: true,
            queue: [],
            activePlaylistId: "PL_ABC",
            account: Account(name: "Jane", avatarUrl: "u"),
            loggedIn: true
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(PlayerState.self, from: data)
        #expect(decoded == original)
    }
}
