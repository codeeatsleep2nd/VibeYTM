import Foundation
import AppIntents

/// Playback control intents — exposed to Siri, Spotlight, Shortcuts.app,
/// Control Center, and (Sprint 4) interactive widget buttons.
///
/// In-process path (Sprint 3): when the host app is running and the user
/// invokes one of these intents via Shortcuts.app or Siri, `perform()`
/// dispatches through the `PlaybackIntentDispatcher` shared protocol that
/// the host implements against `BridgeHost`.
///
/// Cross-process path (Sprint 4): when an extension target (widget,
/// Control Center tile, AppIntents extension) invokes an intent,
/// `perform()` writes a command record to the App Group container and
/// posts a Darwin notification; the host's drainer picks it up and
/// dispatches.
///
/// Sprint 3 partial scope: only the in-process path is wired. The
/// extension cross-process path lands in Sprint 4 alongside widget code.

// MARK: - Dispatcher protocol

/// Shared abstraction between the host process (which implements this by
/// calling BridgeHost directly) and extension processes (which implement
/// it by writing a command file + posting Darwin notification). The host
/// injects its implementation into `PlaybackIntentDispatcher.current`
/// at app launch.
public protocol PlaybackIntentDispatcher: Sendable {
    func play() async throws
    func pause() async throws
    func togglePlay() async throws
    func next() async throws
    func previous() async throws
    func toggleLike() async throws
    func playTrack(videoId: String) async throws
}

/// Default no-op dispatcher. The host process replaces this with a real
/// BridgeHost-backed dispatcher at launch. Extensions replace it with a
/// file-based dispatcher (Sprint 4).
public struct NoOpPlaybackIntentDispatcher: PlaybackIntentDispatcher {
    public init() {}
    public func play() async throws {}
    public func pause() async throws {}
    public func togglePlay() async throws {}
    public func next() async throws {}
    public func previous() async throws {}
    public func toggleLike() async throws {}
    public func playTrack(videoId: String) async throws {}
}

/// Mutable global slot. Set once at app launch — `await
/// PlaybackIntentRegistry.set(dispatcher)` — then read by every intent's
/// `perform()`. `@unchecked Sendable` is acceptable here because we
/// serialize all writes through MainActor.
public actor PlaybackIntentRegistry {
    public static let shared = PlaybackIntentRegistry()
    private var dispatcher: any PlaybackIntentDispatcher = NoOpPlaybackIntentDispatcher()

    public func set(_ newDispatcher: any PlaybackIntentDispatcher) {
        dispatcher = newDispatcher
    }

    public func current() -> any PlaybackIntentDispatcher {
        dispatcher
    }
}

// MARK: - Intents

public struct PlayPauseIntent: AudioPlaybackIntent {
    public static let title: LocalizedStringResource = "Play / Pause"
    public static let description = IntentDescription(
        "Toggle playback in VibeYTM."
    )

    public init() {}

    public func perform() async throws -> some IntentResult {
        let dispatcher = await PlaybackIntentRegistry.shared.current()
        try await dispatcher.togglePlay()
        return .result()
    }
}

public struct NextTrackIntent: AudioPlaybackIntent {
    public static let title: LocalizedStringResource = "Next Track"
    public static let description = IntentDescription(
        "Skip to the next track in the queue."
    )

    public init() {}

    public func perform() async throws -> some IntentResult {
        let dispatcher = await PlaybackIntentRegistry.shared.current()
        try await dispatcher.next()
        return .result()
    }
}

public struct PreviousTrackIntent: AudioPlaybackIntent {
    public static let title: LocalizedStringResource = "Previous Track"
    public static let description = IntentDescription(
        "Go back to the previous track."
    )

    public init() {}

    public func perform() async throws -> some IntentResult {
        let dispatcher = await PlaybackIntentRegistry.shared.current()
        try await dispatcher.previous()
        return .result()
    }
}

public struct LikeCurrentTrackIntent: AppIntent {
    public static let title: LocalizedStringResource = "Like Current Track"
    public static let description = IntentDescription(
        "Mark the currently playing track as liked in YouTube Music."
    )

    public init() {}

    public func perform() async throws -> some IntentResult {
        let dispatcher = await PlaybackIntentRegistry.shared.current()
        try await dispatcher.toggleLike()
        return .result()
    }
}

public struct PlayTrackIntent: AudioPlaybackIntent {
    public static let title: LocalizedStringResource = "Play Track"
    public static let description = IntentDescription(
        "Play a specific track in VibeYTM by its YouTube videoId."
    )

    @Parameter(title: "Track")
    public var track: TrackEntity

    public init() {}

    public init(track: TrackEntity) {
        self.track = track
    }

    public func perform() async throws -> some IntentResult {
        let dispatcher = await PlaybackIntentRegistry.shared.current()
        try await dispatcher.playTrack(videoId: track.id)
        return .result()
    }
}
