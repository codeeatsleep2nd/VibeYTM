import Foundation

/// Mirrors `PlaybackStatus` in `src-tauri/src/state/player.rs`. Default is
/// `idle` so a freshly constructed `PlayerState` reports a sane state
/// before the bridge has emitted anything.
public enum PlaybackStatus: String, Codable, Sendable, Equatable, CaseIterable {
    case playing
    case paused
    case buffering
    case idle
}
