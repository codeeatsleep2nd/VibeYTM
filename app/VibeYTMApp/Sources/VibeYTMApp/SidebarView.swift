import SwiftUI
import PlayerCore
import YTMBridge

/// Sidebar grouped into three sections + a profile row pinned to the
/// bottom — mirrors Apple Music's macOS 26 layout. macOS 26's sidebar
/// styling already gives us Liquid Glass and the rounded selection chip,
/// so all this view does is wire the right sections.
///
/// Section model:
///   • Browse — Home, Explore
///   • Library — Recently Played, Artists, Albums, Songs
///   • Playlists — All Playlists (placeholder; real playlists land with
///     the Innertube/YTMData client)
///
/// Identifiers stay stable across launches so navigation state can be
/// persisted in a follow-up batch.
enum SidebarSection: String, CaseIterable, Hashable, Identifiable {
    case home, explore
    case recentlyPlayed, artists, albums, songs
    case allPlaylists
    case search

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "Home"
        case .explore: "Explore"
        case .recentlyPlayed: "History"
        case .artists: "Artists"
        case .albums: "Albums"
        case .songs: "Songs"
        case .allPlaylists: "Playlists"
        case .search: "Search"
        }
    }

    var systemImage: String {
        switch self {
        case .home: "house"
        case .explore: "sparkles"
        case .recentlyPlayed: "clock.arrow.circlepath"
        case .artists: "music.mic"
        case .albums: "square.stack"
        case .songs: "music.note"
        case .allPlaylists: "rectangle.stack"
        case .search: "magnifyingglass"
        }
    }
}

struct SidebarView: View {
    @Binding var selection: SidebarSection
    @Environment(PlayerStore.self) private var store

    var body: some View {
        VStack(spacing: 0) {
            List(selection: $selection) {
                Section {
                    row(.search)
                }
                Section("Browse") {
                    row(.home)
                    row(.explore)
                }
                Section("Library") {
                    row(.recentlyPlayed)
                    row(.artists)
                    row(.albums)
                    row(.songs)
                }
                Section("Playlists") {
                    row(.allPlaylists)
                }
            }
            .listStyle(.sidebar)

            ProfileRow(account: store.state.account)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
        }
        // Reserve space for the macOS traffic-light buttons at the top
        // (we use `.windowStyle(.hiddenTitleBar)` so the system doesn't
        // automatically push content down). 32 pt clears the close /
        // minimise / maximise buttons without crowding the search row.
        .safeAreaInset(edge: .top, spacing: 0) {
            Color.clear.frame(height: 32)
        }
        // Window has a ~12 pt corner radius. Without an explicit leading
        // inset, the sidebar's section headers, row dividers, and the
        // List's own background insets all hug x=0 — the window mask
        // then clips the leftmost few pixels of every horizontal element
        // (icons, header text, separator lines). Padding the entire
        // sidebar interior by 12 pt leading shifts everything inside the
        // safe area of the rounded corner.
        .safeAreaInset(edge: .leading, spacing: 0) {
            Color.clear.frame(width: 16)
        }
        .navigationTitle("VibeYTM")
    }

    /// Custom sidebar row.
    ///
    /// The stock `Label(_:systemImage:)` inside a `.sidebar`-styled List
    /// renders the icon flush with the column's leading edge, where the
    /// window's rounded corner clips the leftmost pixels of each glyph
    /// (Explore's sparkle, Albums' stacked-square, etc). `.padding`
    /// on the row is silently absorbed by the list style — `.listRowInsets`
    /// is the correct API to override the row's leading inset. We also
    /// bump the icon size to 16 pt so it visually balances the title
    /// text instead of looking like a tiny disc next to a normal label.
    private func row(_ section: SidebarSection) -> some View {
        HStack(spacing: 10) {
            Image(systemName: section.systemImage)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 24)
                .foregroundStyle(.primary)
            Text(section.title)
            Spacer(minLength: 0)
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 8))
        .tag(section)
    }
}

/// Bottom-pinned profile pill. Shows the avatar + display name when the
/// bridge has reported an account; otherwise a generic placeholder. The
/// avatar URL is async-loaded; failures fall back to the SF Symbol.
private struct ProfileRow: View {
    let account: Account?

    var body: some View {
        HStack(spacing: 8) {
            avatar
                .frame(width: 28, height: 28)
                .clipShape(Circle())
            Text(account?.name ?? "Not signed in")
                .font(.callout)
                .foregroundStyle(account == nil ? .secondary : .primary)
                .lineLimit(1)
            Spacer()
        }
    }

    @ViewBuilder
    private var avatar: some View {
        CachedAsyncImage(url: avatarURL) {
            placeholder
        }
    }

    private var avatarURL: URL? {
        guard let raw = account?.avatarUrl, !raw.isEmpty else { return nil }
        return URL(string: raw)
    }

    private var placeholder: some View {
        Image(systemName: "person.crop.circle.fill")
            .resizable()
            .foregroundStyle(.secondary)
    }
}
