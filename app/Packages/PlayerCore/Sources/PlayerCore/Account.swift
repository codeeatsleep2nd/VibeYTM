import Foundation

/// Mirrors `AccountInfo` in `src-tauri/src/state/player.rs`. JSON keys are
/// camelCase (`name`, `avatarUrl`) — the Rust side used `#[serde(rename_all
/// = "camelCase")]` so the YTM bridge could consume the same payload.
public struct Account: Codable, Sendable, Equatable {
    public let name: String
    public let avatarUrl: String

    public init(name: String, avatarUrl: String) {
        self.name = name
        self.avatarUrl = avatarUrl
    }
}
