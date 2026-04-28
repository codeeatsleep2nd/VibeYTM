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
    /// Save-to-library state (#54 / #55). Tri-state: `nil` = unsaved
    /// (initial), `true` = saved, `false` = saved-then-removed in
    /// this session. We don't parse YTM's response for the initial
    /// like-status yet — that's a per-renderer extraction job. The
    /// button starts as "Save" and toggles on click; if the user
    /// already had this album saved, hitting Save again is a no-op
    /// on the YTM side (idempotent).
    @State private var savedToLibrary: Bool = false
    @State private var savePending: Bool = false

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

                        Button {
                            if let lead { bootstrap.shuffleAndPlay(item: lead) }
                        } label: {
                            Label("Shuffle", systemImage: "shuffle")
                                .font(.headline)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.bordered)

                        // Save / Remove from Library (#54 / #55) — only
                        // for browseIds that map to a saveable playlist
                        // (albums + community playlists). Artist /
                        // search-result browseIds don't have a single
                        // playlistId we can like, so the button is
                        // hidden for those.
                        if let pid = lead?.playlistId, isLibrarySaveable {
                            Button {
                                Task { await toggleSave(playlistId: pid) }
                            } label: {
                                Label(
                                    savedToLibrary ? "Remove from Library" : "Save to Library",
                                    systemImage: savedToLibrary ? "minus" : "plus"
                                )
                                .font(.headline)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                            }
                            .buttonStyle(.bordered)
                            .disabled(savePending)
                        }
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

    /// Whether this browse page corresponds to something the user can
    /// add to / remove from their library. MPRE / MPLA / OLAK
    /// (album-as-audio-playlist) and VL / PL (regular playlists) all
    /// support like_playlist. Artist channels (UC / MPLA) and search
    /// indices don't.
    private var isLibrarySaveable: Bool {
        let upper = browseId.uppercased()
        return upper.hasPrefix("MPRE")
            || upper.hasPrefix("VL")
            || upper.hasPrefix("PL")
            || upper.hasPrefix("OLAK")
    }

    private func toggleSave(playlistId: String) async {
        savePending = true
        defer { savePending = false }
        let target = !savedToLibrary
        let ok = await bootstrap.setSavedToLibrary(playlistId: playlistId, saved: target)
        if ok {
            savedToLibrary = target
        }
    }
}

/// Lightweight value-type route — gives `NavigationLink(value:)` a payload
/// without taking a hard dependency on `ShelfItem` shape stability.
struct BrowseDestination: Hashable {
    let browseId: String
    let title: String
}
