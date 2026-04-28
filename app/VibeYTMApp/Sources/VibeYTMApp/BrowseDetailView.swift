import SwiftUI
import YTMBridge

/// Drill-down detail for a browseId — albums (`MPRE...`), playlists
/// (`VL...`), artists (`UC...`/`MPLA...`). Renders an editorial header
/// (cover + title + Play / Shuffle buttons) above the shelves the
/// browseId returns.
///
/// The header derives its cover and Play target from the first playable
/// item in the first shelf — that's the convention albums and
/// playlists follow on YTM, and it avoids a second IPC just to fetch
/// header metadata. Artist pages don't always have a leading playable
/// item; in that case the Play button is hidden and the cover falls
/// back to a generic placeholder.
struct BrowseDetailView: View {
    let browseId: String
    let title: String

    @Environment(AppBootstrap.self) private var bootstrap
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
                    header
                    ForEach(shelves) { shelf in
                        ShelfRow(shelf: shelf)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
            }
        }
        .navigationTitle(title)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private var header: some View {
        let lead = leadItem()
        HStack(alignment: .bottom, spacing: 24) {
            cover(url: lead?.artworkUrl)
                .frame(width: 220, height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: .black.opacity(0.25), radius: 16, y: 6)

            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(.system(size: 36, weight: .bold))
                    .lineLimit(2)
                if let subtitle = lead?.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if lead?.videoId != nil || lead?.playlistId != nil {
                    HStack(spacing: 12) {
                        Button {
                            if let lead { bootstrap.play(item: lead) }
                        } label: {
                            Label("Play", systemImage: "play.fill")
                                .font(.headline)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.borderedProminent)

                        // Shuffle starts the lead track AND toggles
                        // shuffle, but the shuffle command needs to land
                        // AFTER YTM has loaded the new track and
                        // initialised its queue context — otherwise it
                        // gets dropped or applied to the previous queue.
                        // Bootstrap.shuffleAndPlay sequences the two
                        // calls with the right delay.
                        Button {
                            if let lead { bootstrap.shuffleAndPlay(item: lead) }
                        } label: {
                            Label("Shuffle", systemImage: "shuffle")
                                .font(.headline)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private func cover(url: String?) -> some View {
        CachedAsyncImage(url: url.flatMap(URL.init(string:))) {
            coverPlaceholder
        }
    }

    private var coverPlaceholder: some View {
        Rectangle()
            .fill(.secondary.opacity(0.15))
            .overlay {
                Image(systemName: "music.note")
                    .font(.system(size: 48))
                    .foregroundStyle(.secondary)
            }
    }

    /// First item in the first shelf with either a videoId, playlistId, or
    /// at minimum an artworkUrl — used to drive the header's Play button
    /// and cover image. Returns `nil` for browse responses that have no
    /// playable lead (some artist pages).
    private func leadItem() -> ShelfItem? {
        for shelf in shelves {
            for item in shelf.items {
                if item.videoId != nil || item.playlistId != nil || item.artworkUrl != nil {
                    return item
                }
            }
        }
        return nil
    }

    private var loadingState: some View {
        VStack(spacing: 8) {
            ProgressView()
            Text("Loading…")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 80)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "square.stack")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("No content")
                .font(.headline)
            Text("YouTube Music returned an empty response for this page.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 80)
    }

    private func load() async {
        loading = true
        shelves = await bootstrap.getBrowseShelves(browseId: browseId)
        loading = false
    }
}

/// Lightweight value-type route — gives `NavigationLink(value:)` a payload
/// without taking a hard dependency on `ShelfItem` shape stability.
struct BrowseDestination: Hashable {
    let browseId: String
    let title: String
}
