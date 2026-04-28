import SwiftUI
import YTMBridge

/// Real Home content. Fetches YTM's `FEmusic_home` browse response on
/// appear and renders each shelf as a section header + horizontally
/// scrolling row of cards.
struct HomeView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    var body: some View {
        ShelvesView(
            emptyStateIcon: "music.note.house",
            emptyStateTitle: "No home content yet",
            emptyStateBody: "Sign in to YouTube Music or wait for the bridge to finish loading.",
            loadingLabel: "Loading home…",
            fetch: bootstrap.getHomeShelves
        )
    }
}

/// Mirror of HomeView for the `FEmusic_explore` browse response.
struct ExploreView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    var body: some View {
        ShelvesView(
            emptyStateIcon: "sparkles",
            emptyStateTitle: "No explore content yet",
            emptyStateBody: "Sign in to YouTube Music or try again in a moment.",
            loadingLabel: "Loading explore…",
            fetch: bootstrap.getExploreShelves
        )
    }
}

/// Generic shelves list — used by Home, Explore, and the Library
/// subsections. Caller hands in a `fetch` closure that returns
/// `[Shelf]` and an empty-state copy. Shelf rendering is a horizontally
/// scrolling row of cards; cards are tappable when they carry a
/// `videoId` or `playlistId`.
struct ShelvesView: View {
    let emptyStateIcon: String
    let emptyStateTitle: String
    let emptyStateBody: String
    let loadingLabel: String
    let fetch: @MainActor () async -> [Shelf]

    @State private var shelves: [Shelf] = []
    @State private var loading = true

    var body: some View {
        ScrollView(.vertical) {
            if loading && shelves.isEmpty {
                loadingState
            } else if shelves.isEmpty {
                emptyState
            } else {
                LazyVStack(alignment: .leading, spacing: 28) {
                    ForEach(shelves) { shelf in
                        ShelfRow(shelf: shelf)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private var loadingState: some View {
        VStack(spacing: 8) {
            ProgressView()
            Text(loadingLabel)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 80)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: emptyStateIcon)
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text(emptyStateTitle)
                .font(.headline)
            Text(emptyStateBody)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 80)
    }

    private func load() async {
        loading = true
        shelves = await fetch()
        loading = false
    }
}

struct ShelfRow: View {
    let shelf: Shelf
    @Environment(AppBootstrap.self) private var bootstrap

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(shelf.title)
                .font(.title2.weight(.semibold))
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 16) {
                    ForEach(shelf.items) { item in
                        cardLink(for: item)
                    }
                }
            }
        }
    }

    /// A card with a `videoId` plays directly. A card with a `browseId`
    /// (album / playlist / artist page) pushes a detail view onto the
    /// NavigationStack. Cards with both prefer playback — that matches
    /// Apple Music's "tap to play, long-press for detail" mental model
    /// at the home shelves; explicit drill-in lands when a card has
    /// browseId only.
    @ViewBuilder
    private func cardLink(for item: ShelfItem) -> some View {
        if item.videoId == nil, let browseId = item.browseId {
            NavigationLink(value: BrowseDestination(browseId: browseId, title: item.title)) {
                ShelfCard(item: item)
            }
            .buttonStyle(.plain)
        } else {
            ShelfCard(item: item)
                .onTapGesture { bootstrap.play(item: item) }
        }
    }
}

struct ShelfCard: View {
    let item: ShelfItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CachedAsyncImage(url: item.artworkUrl.flatMap(URL.init(string:))) {
                placeholder
            }
            .frame(width: 160, height: 160)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Text(item.title)
                .font(.callout)
                .lineLimit(1)
                .frame(width: 160, alignment: .leading)

            if !item.subtitle.isEmpty {
                Text(item.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .frame(width: 160, alignment: .leading)
            }
        }
        .contentShape(Rectangle())
    }

    private var placeholder: some View {
        Rectangle()
            .fill(.secondary.opacity(0.15))
    }
}
