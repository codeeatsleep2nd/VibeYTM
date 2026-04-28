import Foundation

/// Single source of truth for player state. Value-type snapshot; the bridge
/// actor produces a fresh `PlayerState` on every poll cycle and the SwiftUI
/// store layer (lands in a follow-up commit) wraps it in `@Observable` so
/// views can re-render on change. Mirrors `PlayerState` in
/// `src-tauri/src/state/player.rs`.
///
/// Codable conforms via JSONEncoder (camelCase keys to match the Rust serde
/// payload). `pendingRestore` is excluded from coding because it's a
/// launch-time signal that must never round-trip through persistence —
/// matching the Rust `#[serde(skip)]`.
public struct PlayerState: Codable, Sendable, Equatable {
    public var status: PlaybackStatus
    public var track: Track?
    public var positionSecs: Double
    public var volume: Double
    public var isLiked: Bool
    public var repeatMode: RepeatMode
    public var isShuffled: Bool
    public var queue: [Track]

    /// The playlist/album/radio context the user last started playing from.
    /// Persisted across restarts so the queue rebuild after launch uses the
    /// same `&list=…` parameter as the prior session.
    public var activePlaylistId: String?

    public var account: Account?

    /// Tri-state YTM sign-in status. `nil` = unknown (bridge not yet
    /// loaded), `true` = signed in, `false` = signed out. Used on app
    /// launch to decide whether to skip the login page (issue #51) and to
    /// avoid rendering stale signed-in data after sign-out (issue #50).
    public var loggedIn: Bool?

    /// On launch, populated from the persisted session if a track was
    /// previously playing. Player commands check this BEFORE forwarding
    /// "play" to YTM. Cleared on first consumption or when the user
    /// explicitly navigates to a different track. **Never persisted.**
    public var pendingRestore: PendingRestore?

    public init(
        status: PlaybackStatus = .idle,
        track: Track? = nil,
        positionSecs: Double = 0,
        volume: Double = 1.0,
        isLiked: Bool = false,
        repeatMode: RepeatMode = .none,
        isShuffled: Bool = false,
        queue: [Track] = [],
        activePlaylistId: String? = nil,
        account: Account? = nil,
        loggedIn: Bool? = nil,
        pendingRestore: PendingRestore? = nil
    ) {
        self.status = status
        self.track = track
        self.positionSecs = positionSecs
        self.volume = volume
        self.isLiked = isLiked
        self.repeatMode = repeatMode
        self.isShuffled = isShuffled
        self.queue = queue
        self.activePlaylistId = activePlaylistId
        self.account = account
        self.loggedIn = loggedIn
        self.pendingRestore = pendingRestore
    }

    private enum CodingKeys: String, CodingKey {
        case status
        case track
        case positionSecs
        case volume
        case isLiked
        case repeatMode
        case isShuffled
        case queue
        case activePlaylistId
        case account
        case loggedIn
        // pendingRestore intentionally omitted — never serialized.
    }
}
