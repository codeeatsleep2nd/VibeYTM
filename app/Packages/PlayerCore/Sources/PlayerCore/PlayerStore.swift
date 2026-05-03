import Foundation
import Observation

/// SwiftUI-facing wrapper around `PlayerState`. The store holds the latest
/// snapshot and emits change notifications via `@Observable` so views can
/// reactively re-render. `@MainActor` because SwiftUI consumes from the
/// main thread; the bridge already runs there too (WebKit constraint),
/// so no actor hop is needed.
///
/// Wire-up: a single instance is created at app launch, owned by
/// `VibeYTMApp.AppBootstrap`, and made available to the view tree via
/// `.environment(playerStore)`. The bootstrap layer feeds bridge snapshots
/// through the `BridgeReducer` (in YTMBridge) and writes the result via
/// `apply(_:)`. No reducer composition lives here — the store is a thin
/// data carrier so PlayerCore stays a pure-types module with no
/// dependency on YTMBridge.
@MainActor
@Observable
public final class PlayerStore {
    public private(set) var state: PlayerState

    public init(initial: PlayerState = PlayerState()) {
        self.state = initial
    }

    /// Replace the entire state. The only mutation entry point — keeps
    /// the snapshot semantics from `PlayerState` (immutable value type)
    /// flowing through the store layer.
    public func apply(_ next: PlayerState) {
        self.state = next
    }
}
