import SwiftUI
import YTMBridge

/// Thin per-subsection wrapper around `ShelvesView`. Each library
/// subsection (Recently Played / Artists / Albums / Songs / All
/// Playlists) hits a different YTM browseId, but the rendering surface
/// is identical so we share `ShelvesView`.
struct RecentlyPlayedView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    var body: some View {
        ShelvesView(
            emptyStateIcon: "clock",
            emptyStateTitle: "Nothing recent",
            emptyStateBody: "Listen to something — your history will show up here.",
            loadingLabel: "Loading history…",
            cacheKey: "library_history",
            fetch: bootstrap.getRecentlyPlayedShelves
        )
    }
}

struct LibraryArtistsView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    var body: some View {
        ShelvesView(
            emptyStateIcon: "music.mic",
            emptyStateTitle: "No artists in library",
            emptyStateBody: "Subscribe to an artist on YouTube Music — they'll appear here.",
            loadingLabel: "Loading artists…",
            cacheKey: "library_artists",
            fetch: bootstrap.getLibraryArtistsShelves
        )
    }
}

struct LibraryAlbumsView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    var body: some View {
        ShelvesView(
            emptyStateIcon: "square.stack",
            emptyStateTitle: "No albums in library",
            emptyStateBody: "Add an album to your library on YouTube Music — it'll appear here.",
            loadingLabel: "Loading albums…",
            cacheKey: "library_albums",
            fetch: bootstrap.getLibraryAlbumsShelves
        )
    }
}

struct LibrarySongsView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    var body: some View {
        ShelvesView(
            emptyStateIcon: "music.note",
            emptyStateTitle: "No liked songs",
            emptyStateBody: "Like a song on YouTube Music — it'll appear here.",
            loadingLabel: "Loading songs…",
            cacheKey: "library_songs",
            fetch: bootstrap.getLibrarySongsShelves
        )
    }
}

struct AllPlaylistsView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    var body: some View {
        ShelvesView(
            emptyStateIcon: "rectangle.stack",
            emptyStateTitle: "No playlists yet",
            emptyStateBody: "Save a playlist on YouTube Music — it'll appear here.",
            loadingLabel: "Loading playlists…",
            cacheKey: "library_playlists",
            fetch: bootstrap.getLibraryPlaylistsShelves
        )
    }
}

struct LibraryPodcastsView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    var body: some View {
        ShelvesView(
            emptyStateIcon: "headphones",
            emptyStateTitle: "No subscribed podcasts",
            emptyStateBody: "Subscribe to a podcast on YouTube Music — it'll appear here.",
            loadingLabel: "Loading podcasts…",
            cacheKey: "library_podcasts",
            fetch: bootstrap.getLibraryPodcastsShelves
        )
    }
}
