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
            cacheKey: "home",
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
            cacheKey: "explore",
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
    /// Cache key — the bootstrap helper that backs this surface (e.g.
    /// `home`, `explore`, `library_albums`). Surfaces using the same
    /// `fetch` closure but a different `cacheKey` get separate cache
    /// entries; pass the same key when intentionally sharing.
    let cacheKey: String
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
        .task { await load(force: false) }
        .refreshable { await load(force: true) }
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

    private func load(force: Bool) async {
        // #15 — Explore (and every other shelves view) re-fetches on
        // every appearance. SwiftUI's `.task` re-fires when the view
        // re-mounts, which happens every sidebar nav. Cache results for
        // 10 minutes per cacheKey so switching tabs is instant; pull
        // -to-refresh forces a fresh fetch.
        if !force, let cached = ShelvesCache.shared.read(key: cacheKey) {
            shelves = cached
            loading = false
            return
        }
        if shelves.isEmpty {
            loading = true
        }
        let result = await fetch()
        shelves = result
        loading = false
        if !result.isEmpty {
            ShelvesCache.shared.write(key: cacheKey, shelves: result)
        }
    }
}

/// Process-lifetime cache for shelf fetches. 10-minute TTL — long
/// enough that sidebar navigation feels instant, short enough that
/// stale results don't linger past the user's session window. Cleared
/// on app quit (cache is in-memory only — durable persistence would
/// require careful invalidation on sign-in / sign-out / library
/// mutations and isn't worth the complexity yet).
@MainActor
private final class ShelvesCache {
    static let shared = ShelvesCache()
    private let ttl: TimeInterval = 10 * 60
    private var entries: [String: (at: Date, shelves: [Shelf])] = [:]

    func read(key: String) -> [Shelf]? {
        guard let entry = entries[key] else { return nil }
        guard Date().timeIntervalSince(entry.at) < ttl else {
            entries.removeValue(forKey: key)
            return nil
        }
        return entry.shelves
    }

    func write(key: String, shelves: [Shelf]) {
        entries[key] = (Date(), shelves)
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
            .modifier(ShelfItemContextMenu(item: item))
        } else {
            ShelfCard(item: item)
                .onTapGesture { bootstrap.play(item: item) }
                .modifier(ShelfItemContextMenu(item: item))
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
