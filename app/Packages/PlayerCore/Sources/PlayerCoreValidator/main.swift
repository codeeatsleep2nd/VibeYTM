import Foundation
import PlayerCore

// CLT-only proxy for Tests/PlayerCoreTests/PlayerStateTests.swift. Same
// rationale as the YTMBridge validators — `import Testing` fails on
// Command Line Tools 6.2 because `_Testing_Foundation.framework` ships
// without a swiftmodule. Delete this target once Xcode 26 is installed.

@main
struct Main {
    static func main() {
        struct Case {
            let name: String
            let body: () -> Bool
        }

        let cases: [Case] = [
            Case(name: "Account encodes with camelCase keys (avatarUrl, not avatar_url)") {
                let account = Account(name: "Jane", avatarUrl: "https://example.test/a.jpg")
                guard let data = try? JSONEncoder().encode(account),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                else { return false }
                return json["name"] as? String == "Jane"
                    && json["avatarUrl"] as? String == "https://example.test/a.jpg"
                    && json["avatar_url"] == nil
            },
            Case(name: "Account equality enables change detection") {
                let a = Account(name: "A", avatarUrl: "u")
                let b = Account(name: "A", avatarUrl: "u")
                let c = Account(name: "A", avatarUrl: "v")
                return a == b && a != c
            },
            Case(name: "PlayerState default has no account, idle, volume 1.0") {
                let s = PlayerState()
                return s.account == nil
                    && s.status == .idle
                    && s.volume == 1.0
                    && s.repeatMode == .none
                    && s.isShuffled == false
                    && s.queue.isEmpty
                    && s.loggedIn == nil
            },
            Case(name: "PlayerState serializes account when present") {
                let s = PlayerState(account: Account(name: "Jane", avatarUrl: "u"))
                guard let data = try? JSONEncoder().encode(s),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let acct = json["account"] as? [String: Any]
                else { return false }
                return acct["name"] as? String == "Jane"
            },
            Case(name: "PlayerState pendingRestore never appears in encoded JSON") {
                // Mirrors the Rust `#[serde(skip)]` on PendingRestore — even
                // when set, encoding must not include the key. Saving this
                // to disk and reloading would otherwise resurrect a stale
                // restore signal across launches.
                let s = PlayerState(pendingRestore: PendingRestore(
                    videoId: "abc", positionSecs: 42, playlistId: nil
                ))
                guard let data = try? JSONEncoder().encode(s),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                else { return false }
                return json["pendingRestore"] == nil
                    && json["pending_restore"] == nil
            },
            Case(name: "PlaybackStatus encodes with snake_case raw values") {
                // The Rust side serializes with snake_case (`buffering`,
                // `playing`, `paused`, `idle`). Our enum cases are already
                // lowercase strings so this just confirms the rawValue path.
                guard let data = try? JSONEncoder().encode(PlaybackStatus.buffering),
                      let s = String(data: data, encoding: .utf8)
                else { return false }
                return s == "\"buffering\""
            },
            Case(name: "RepeatMode round-trips through JSON") {
                let original: [RepeatMode] = [.none, .one, .all]
                guard let data = try? JSONEncoder().encode(original),
                      let decoded = try? JSONDecoder().decode([RepeatMode].self, from: data)
                else { return false }
                return decoded == original
            },
            Case(name: "Track Identifiable id is videoId") {
                let t = Track(
                    videoId: "abc",
                    title: "T",
                    artist: "A",
                    album: "L",
                    durationSecs: 180
                )
                return t.id == "abc"
            },
            Case(name: "PlayerState round-trips through JSON without pendingRestore") {
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
                guard let data = try? JSONEncoder().encode(original),
                      let decoded = try? JSONDecoder().decode(PlayerState.self, from: data)
                else { return false }
                // pendingRestore is excluded; everything else round-trips.
                return decoded == original
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
