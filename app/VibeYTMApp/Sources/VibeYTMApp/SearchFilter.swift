import Foundation

/// Search filter chips (#18). YTM's `params` blob is a stable filter
/// token that scopes the response to one category (Songs / Albums /
/// Artists / Playlists / Videos). The values come from ytmusicapi's
/// `Filter` enum — YTM doesn't expose them publicly any more, so any
/// future schema change will require a fresh capture from the live
/// search-filter chips.
enum SearchFilter: String, CaseIterable, Identifiable, Hashable {
    case all
    case songs
    case albums
    case artists
    case playlists
    case videos

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All"
        case .songs: "Songs"
        case .albums: "Albums"
        case .artists: "Artists"
        case .playlists: "Playlists"
        case .videos: "Videos"
        }
    }

    var params: String? {
        switch self {
        case .all: nil
        case .songs: "EgWKAQIIAWoMEA4QChADEAQQCRAF"
        case .albums: "EgWKAQIYAWoMEA4QChADEAQQCRAF"
        case .artists: "EgWKAQIgAWoMEA4QChADEAQQCRAF"
        case .playlists: "EgWKAQIoAWoMEA4QChADEAQQCRAF"
        case .videos: "EgWKAQIQAWoMEA4QChADEAQQCRAF"
        }
    }
}
