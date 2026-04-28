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
    @State private var detailHeader: DetailHeader?
    @State private var loading = true
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
        // Prefer the parsed `DetailHeader` from the response — title,
        // subtitle, and cover come from the page's actual header
        // renderer (musicResponsiveHeaderRenderer / musicDetailHeader-
        // Renderer). Fall back to lead-track metadata only when the
        // response shape didn't surface a header (search-result browse,
        // some artist pages).
        let lead = leadItem()
        let displayTitle = detailHeader?.title.isEmpty == false ? detailHeader!.title : title
        let displaySubtitle = detailHeader?.subtitle ?? (lead?.subtitle ?? "")
        let displayArtwork = detailHeader?.artworkUrl ?? lead?.artworkUrl
        HStack(alignment: .bottom, spacing: 24) {
            cover(url: displayArtwork)
                .frame(width: 220, height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: .black.opacity(0.25), radius: 16, y: 6)

            VStack(alignment: .leading, spacing: 12) {
                Text(displayTitle)
                    .font(.system(size: 36, weight: .bold))
                    .lineLimit(2)
                if !displaySubtitle.isEmpty {
                    Text(displaySubtitle)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
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

                        // Save / Remove from Library (#54 / #55).
                        // Prefers the playlistId extracted from the
                        // page's own header (canonical for the album /
                        // playlist / show), falling back to the lead
                        // track's playlistId if the header parser
                        // didn't surface one. Hidden for browseIds
                        // that don't map to a saveable target (artist
                        // pages, search shells).
                        if let pid = saveTargetPlaylistId, isLibrarySaveable {
                            Button {
                                Task { await toggleSave(playlistId: pid) }
                            } label: {
                                Label(
                                    saveButtonLabel,
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
        let response = await bootstrap.getBrowseDetail(browseId: browseId)
        detailHeader = response.header
        shelves = response.shelves
        loading = false
    }

    /// Canonical save target — the playlistId from the page's header
    /// renderer if available (the album's OLAK auto-playlist / the
    /// playlist's own id / the show's audio playlist), otherwise the
    /// lead track's playlist context as a fallback.
    private var saveTargetPlaylistId: String? {
        detailHeader?.audioPlaylistId ?? leadItem()?.playlistId
    }

    /// Button label varies by surface: shows on a podcast page get
    /// Subscribe / Unsubscribe (matches the React tree's #88 work);
    /// everything else gets Save / Remove from Library.
    private var saveButtonLabel: String {
        if isPodcast {
            return savedToLibrary ? "Unsubscribe" : "Subscribe"
        }
        return savedToLibrary ? "Remove from Library" : "Save to Library"
    }

    /// Heuristic: podcast browse ids start with `MPSP` (show) or
    /// `UCSh` (channel-as-show). The detection is conservative — false
    /// negatives just mean the button reads "Save" instead of
    /// "Subscribe", same underlying like_playlist call.
    private var isPodcast: Bool {
        let upper = browseId.uppercased()
        return upper.hasPrefix("MPSP")
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
