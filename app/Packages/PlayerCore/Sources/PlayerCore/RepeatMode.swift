import Foundation

/// Mirrors `RepeatMode` in `src-tauri/src/state/player.rs`. `none` is the
/// default — repeat off.
public enum RepeatMode: String, Codable, Sendable, Equatable, CaseIterable {
    case none
    case one
    case all
}
