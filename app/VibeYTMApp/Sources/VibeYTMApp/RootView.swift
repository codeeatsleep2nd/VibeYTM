import SwiftUI
import PlayerCore

/// Root shell. Always renders the native macOS layout — sidebar + content
/// pane + Liquid Glass chrome at the bottom — regardless of auth state.
/// The auth flow lives inside the content pane only, so the app reads as
/// a real Mac app from launch instead of presenting as a full-window
/// embedded webpage.
struct RootView: View {
    @Environment(AppBootstrap.self) private var bootstrap
    @Environment(AppRouter.self) private var router

    var body: some View {
        // @Bindable lets us pass `$router.selection` / `$router.browseStack`
        // bindings into NavigationSplitView / NavigationStack. Required
        // because router is an @Observable class, not a value type.
        @Bindable var router = router
        NavigationSplitView {
            SidebarView(selection: $router.selection)
                .navigationSplitViewColumnWidth(min: 240, ideal: 260, max: 340)
        } detail: {
            ZStack(alignment: .bottom) {
                NavigationStack(path: $router.browseStack) {
                    DetailContent(section: router.selection)
                        .navigationDestination(for: BrowseDestination.self) { dest in
                            BrowseDetailView(browseId: dest.browseId, title: dest.title)
                        }
                }
                .safeAreaInset(edge: .bottom) {
                    // Reserve vertical space for the floating chrome so
                    // scrollable content can scroll past the chrome's
                    // height instead of being hidden behind it.
                    Color.clear.frame(height: 92)
                }

                PlayerChrome()
                    .padding(.horizontal, 24)
                    .padding(.bottom, 16)
            }
            // Reset the drill-down stack when the sidebar selection
            // changes — switching sections shouldn't preserve a stale
            // album-detail page from a previous section.
            .onChange(of: router.selection) { _, newValue in
                router.browseStack = NavigationPath()
                bootstrap.updatePersistedSidebar(newValue)
            }
        }
        .onAppear {
            // Restore the persisted sidebar selection on first appearance.
            // Doing it here (vs. in router init) gives us access to the
            // bootstrap from the environment.
            router.selection = bootstrap.initialSidebarSelection
        }
        // Sprint 1 — keyboard-shortcut cheatsheet (⌘/). Sheet binding
        // lives on RootView (not PlayerChrome) because the cheatsheet
        // applies to the whole app, not just the player chrome's command
        // surface.
        .sheet(isPresented: $router.isCheatsheetOpen) {
            ShortcutCheatsheet(onDismiss: { router.isCheatsheetOpen = false })
        }
    }
}

/// Branches on the bridge's tri-state `loggedIn` flag at the content
/// layer (not the whole window). Sidebar + chrome stay visible in all
/// cases so the user always sees native UI.
private struct DetailContent: View {
    let section: SidebarSection
    @Environment(PlayerStore.self) private var playerStore

    var body: some View {
        switch playerStore.state.authState {
        case .unknown:
            BootScaffold()
        case .signedOut:
            AuthScaffold()
        case .signedIn:
            SectionScaffold(section: section)
        }
    }
}

private struct BootScaffold: View {
    var body: some View {
        VStack(spacing: 8) {
            ProgressView()
            Text("Booting bridge…")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct AuthScaffold: View {
    private static let authURL = URL(
        string: "https://accounts.google.com/ServiceLogin"
            + "?service=youtube"
            + "&continue=https%3A%2F%2Fmusic.youtube.com"
    )!

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "person.crop.circle.badge.questionmark")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sign in to YouTube Music")
                        .font(.body.weight(.semibold))
                    Text("Your sign-in is sandboxed to this app and shared with the audio engine.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.thinMaterial)

            Divider()

            AuthWebView(url: Self.authURL)
        }
    }
}

private struct SectionScaffold: View {
    let section: SidebarSection

    var body: some View {
        switch section {
        case .home:
            HomeView()
        case .explore:
            ExploreView()
        case .search:
            SearchView()
        case .recentlyPlayed:
            RecentlyPlayedView()
        case .artists:
            LibraryArtistsView()
        case .albums:
            LibraryAlbumsView()
        case .songs:
            LibrarySongsView()
        case .allPlaylists:
            AllPlaylistsView()
        case .podcasts:
            LibraryPodcastsView()
        case .settings:
            SettingsView()
        }
    }

}
