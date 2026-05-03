import Foundation

/// Mirrors `TrackInfo` in `src-tauri/src/state/player.rs`. JSON keys are
/// camelCase (`videoId`, `artistId`, `albumId`, `artworkUrl`,
/// `durationSecs`).
public struct Track: Codable, Sendable, Equatable, Identifiable {
    public let videoId: String
    public let title: String
    public let artist: String
    public let artistId: String?
    public let album: String
    public let albumId: String?
    public let artworkUrl: String?
    public let durationSecs: Double

    /// Identifiable conformance — videoId is the natural identity for a YTM
    /// track. Two queue rows with the same videoId render as the same item;
    /// callers that need positional identity should wrap with their own
    /// index-aware key.
    public var id: String { videoId }

    public init(
        videoId: String,
        title: String,
        artist: String,
        artistId: String? = nil,
        album: String,
        albumId: String? = nil,
        artworkUrl: String? = nil,
        durationSecs: Double
    ) {
        self.videoId = videoId
        self.title = title
        self.artist = artist
        self.artistId = artistId
        self.album = album
        self.albumId = albumId
        self.artworkUrl = artworkUrl
        self.durationSecs = durationSecs
    }
}
