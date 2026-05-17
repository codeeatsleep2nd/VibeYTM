import Foundation
import OSLog
import VibeYTMIntents

private let intentLog = Logger(subsystem: "com.vibeytm.dev", category: "Intent")

/// In-process implementation of `PlaybackIntentDispatcher`. Routes
/// AppIntent invocations to the running `AppBootstrap` so the same code
/// path the user-facing player controls use also services intents from
/// Siri, Shortcuts.app, and (Sprint 4) interactive widgets.
///
/// Registered at app launch via:
///   `await PlaybackIntentRegistry.shared.set(HostPlaybackIntentDispatcher(bootstrap: bootstrap))`
///
/// Captures `bootstrap` weakly to avoid a retain cycle if AppBootstrap is
/// ever reconstructed (currently a singleton, but the weak reference is
/// cheap insurance).
struct HostPlaybackIntentDispatcher: PlaybackIntentDispatcher {
    weak var bootstrap: AppBootstrap?

    init(bootstrap: AppBootstrap) {
        self.bootstrap = bootstrap
    }

    @MainActor
    func play() async throws {
        guard let bootstrap else {
            intentLog.warning("play intent — bootstrap unavailable")
            return
        }
        bootstrap.play()
    }

    @MainActor
    func pause() async throws {
        guard let bootstrap else { return }
        bootstrap.pause()
    }

    @MainActor
    func togglePlay() async throws {
        guard let bootstrap else { return }
        bootstrap.togglePlay()
    }

    @MainActor
    func next() async throws {
        guard let bootstrap else { return }
        bootstrap.next()
    }

    @MainActor
    func previous() async throws {
        guard let bootstrap else { return }
        bootstrap.previous()
    }

    @MainActor
    func toggleLike() async throws {
        guard let bootstrap else { return }
        bootstrap.toggleLike()
    }

    @MainActor
    func playTrack(videoId: String) async throws {
        guard let bootstrap else { return }
        // TODO Sprint 4: bootstrap currently lacks `playTrack(videoId:)`.
        // The closest existing primitive is `play(item:)` for ShelfItems.
        // Sprint 4's bridge-command addition for DJCopilot also gives us
        // this — until then, log the intent and bail.
        intentLog.warning(
            "playTrack intent received for \(videoId, privacy: .public) — Sprint 4 wires the bridge command"
        )
    }
}
