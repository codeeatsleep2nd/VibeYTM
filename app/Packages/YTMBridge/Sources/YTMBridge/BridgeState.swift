import Foundation
import PlayerCore

/// Swift mirror of the `window.__VIBEYTM_STATE__` object the inject script
/// writes inside YTM. Field names match the JS payload exactly so a single
/// `JSONDecoder().decode(BridgeState.self, from: data)` round-trips.
///
/// Decoding-tolerant: every field has a sensible default so partial
/// payloads don't fail the whole cycle. The bridge sometimes emits a
/// nearly-empty state during page transitions (no `getPlayer()` yet) —
/// callers should still be able to decode and propagate that as "no
/// active track."
public struct BridgeState: Codable, Sendable, Equatable {
    public var status: PlaybackStatus
    public var title: String
    public var artist: String
    public var album: String
    public var artworkUrl: String
    public var videoId: String
    public var positionSecs: Double
    public var durationSecs: Double
    public var volume: Double
    public var isShuffled: Bool
    public var repeatMode: RepeatMode
    public var isLiked: Bool
    public var queue: [Track]

    public init(
        status: PlaybackStatus = .idle,
        title: String = "",
        artist: String = "",
        album: String = "",
        artworkUrl: String = "",
        videoId: String = "",
        positionSecs: Double = 0,
        durationSecs: Double = 0,
        volume: Double = 1.0,
        isShuffled: Bool = false,
        repeatMode: RepeatMode = .none,
        isLiked: Bool = false,
        queue: [Track] = []
    ) {
        self.status = status
        self.title = title
        self.artist = artist
        self.album = album
        self.artworkUrl = artworkUrl
        self.videoId = videoId
        self.positionSecs = positionSecs
        self.durationSecs = durationSecs
        self.volume = volume
        self.isShuffled = isShuffled
        self.repeatMode = repeatMode
        self.isLiked = isLiked
        self.queue = queue
    }

    /// True when the bridge has nothing actionable yet — empty videoId is
    /// the JS layer's "no track" signal (see ytm-player-bridge.js
    /// `getPlayer()` early-return).
    public var hasTrack: Bool { !videoId.isEmpty }

    public enum CodingKeys: String, CodingKey {
        case status, title, artist, album, artworkUrl, videoId
        case positionSecs, durationSecs, volume, isShuffled, repeatMode, isLiked
        case queue
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.status = (try? c.decode(PlaybackStatus.self, forKey: .status)) ?? .idle
        self.title = (try? c.decode(String.self, forKey: .title)) ?? ""
        self.artist = (try? c.decode(String.self, forKey: .artist)) ?? ""
        self.album = (try? c.decode(String.self, forKey: .album)) ?? ""
        self.artworkUrl = (try? c.decode(String.self, forKey: .artworkUrl)) ?? ""
        self.videoId = (try? c.decode(String.self, forKey: .videoId)) ?? ""
        self.positionSecs = (try? c.decode(Double.self, forKey: .positionSecs)) ?? 0
        self.durationSecs = (try? c.decode(Double.self, forKey: .durationSecs)) ?? 0
        self.volume = (try? c.decode(Double.self, forKey: .volume)) ?? 1.0
        self.isShuffled = (try? c.decode(Bool.self, forKey: .isShuffled)) ?? false
        self.repeatMode = (try? c.decode(RepeatMode.self, forKey: .repeatMode)) ?? .none
        self.isLiked = (try? c.decode(Bool.self, forKey: .isLiked)) ?? false
        self.queue = (try? c.decode([Track].self, forKey: .queue)) ?? []
    }
}
