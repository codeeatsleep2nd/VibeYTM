import Foundation
import FoundationModels

/// Structured output the model produces in response to a Vibe prompt.
/// Sequenced as `@Generable` so Foundation Models can decode the
/// streaming response into this exact shape.
///
/// The model returns a `description` (the vibe headline shown back to
/// the user — e.g. "Late-night 90s alt-rock, no live versions, ~25 min")
/// and a list of `TrackSuggestion`s the host will resolve to actual
/// YTM videoIds via `Innertube.search` (or use directly when a suggestion
/// already includes a videoId).
@Generable
public struct QueuePlan: Sendable, Equatable {
    @Guide(description: "A one-sentence description of the vibe being built, shown back to the user.")
    public var description: String

    @Guide(description: "Suggested tracks in order. Aim for 10-20 tracks unless the user asked for a specific length.")
    public var tracks: [TrackSuggestion]
}

@Generable
public struct TrackSuggestion: Sendable, Equatable {
    @Guide(description: "Exact YouTube videoId if you know it (11 characters). Leave empty if you only know the track + artist by name; the app will search for it.")
    public var videoId: String

    @Guide(description: "Track title.")
    public var title: String

    @Guide(description: "Primary artist.")
    public var artist: String

    @Guide(description: "One short sentence on why this track fits the vibe.")
    public var reason: String
}

/// Multi-segment session plan — for longer prompts like "build me a
/// 90-minute workout playlist" where the model can structure the arc:
/// warm-up → peak → cool-down. Each segment is its own `QueuePlan`.
@Generable
public struct SessionPlan: Sendable, Equatable {
    @Guide(description: "Mood / theme headline for the whole session.")
    public var mood: String

    @Guide(description: "Approximate session length in minutes.")
    public var lengthMinutes: Int

    @Guide(description: "Ordered segments. Each segment has its own description and tracks.")
    public var segments: [QueuePlan]
}
