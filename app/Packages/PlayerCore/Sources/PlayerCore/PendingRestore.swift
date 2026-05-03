import Foundation

/// Saved playback context to restore on first user-initiated play after app
/// launch. Mirrors `PendingRestore` in `src-tauri/src/state/player.rs`.
/// Player commands check this BEFORE forwarding "play" to YTM — when set,
/// they navigate the YTM webview to the saved track + position first so
/// the user resumes exactly where they left off. Cleared on first
/// consumption or when the user explicitly navigates to a different track.
/// **Never persisted** — this is purely a launch-time signal.
public struct PendingRestore: Sendable, Equatable {
    public let videoId: String
    public let positionSecs: Double
    public let playlistId: String?

    public init(videoId: String, positionSecs: Double, playlistId: String? = nil) {
        self.videoId = videoId
        self.positionSecs = positionSecs
        self.playlistId = playlistId
    }
}
