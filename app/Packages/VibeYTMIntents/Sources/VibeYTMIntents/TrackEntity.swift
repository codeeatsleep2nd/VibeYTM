import Foundation
import AppIntents
import PlayerCore

/// AppEntity wrapper around `PlayerCore.Track`. Lets SwiftUI Shortcuts
/// + Spotlight treat individual YouTube Music tracks as first-class
/// entities the user can search, drop into shortcut workflows, or open
/// from Spotlight.
///
/// Why wrap vs. extend: PlayerCore stays platform-agnostic (no AppIntents
/// dependency). The wrapper lives in VibeYTMIntents, keeping the
/// architectural boundary clean. The cost is one struct per entity type;
/// the cost of not wrapping would be PlayerCore taking a hard dependency
/// on AppIntents, which would block PlayerCoreValidator from running on
/// systems without the AppIntents framework available.
///
/// Identifier scheme: `videoId` is the natural identity for a YTM track.
/// Two TrackEntity values with the same videoId represent the same
/// underlying track regardless of which playlist surfaced it.
public struct TrackEntity: AppEntity, Identifiable, Sendable {
    public static let typeDisplayRepresentation: TypeDisplayRepresentation = "Track"

    public static let defaultQuery = TrackEntityQuery()

    public let id: String  // videoId
    public let title: String
    public let artist: String
    public let album: String
    public let artworkURL: String?
    public let durationSecs: Double

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(title)",
            subtitle: "\(artist)"
        )
    }

    public init(track: Track) {
        self.id = track.videoId
        self.title = track.title
        self.artist = track.artist
        self.album = track.album
        self.artworkURL = track.artworkUrl
        self.durationSecs = track.durationSecs
    }
}

/// Minimal entity query — full Spotlight indexing + entity browsing
/// requires hooking into the running app's library state, which lives in
/// the host process. For Sprint 3 partial, the query returns an empty
/// set (Shortcuts.app shows "no tracks" until the host wires this up via
/// a future `TrackLibraryProvider` injected into the query).
///
/// Sprint 4 work: provide a real `IndexedEntity` conformance + a
/// `EntityProvider` that the host populates from the user's YTM library
/// once it loads.
public struct TrackEntityQuery: EntityQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [TrackEntity] {
        // TODO Sprint 4: look up tracks by videoId from the host's
        // current library state (read SharedPlaybackSnapshot for the
        // current track; consult Innertube for arbitrary videoIds).
        []
    }

    public func suggestedEntities() async throws -> [TrackEntity] {
        // TODO Sprint 4: surface the user's recently-played + saved
        // tracks as suggested entities so Shortcuts.app autocomplete
        // works.
        []
    }
}
