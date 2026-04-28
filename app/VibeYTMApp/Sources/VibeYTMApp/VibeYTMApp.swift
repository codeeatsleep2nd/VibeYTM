import SwiftUI
import AppKit
import PlayerCore
import YTMBridge

@main
struct VibeYTMApp: App {
    @State private var bootstrap = AppBootstrap()
    @NSApplicationDelegateAdaptor(VibeYTMAppDelegate.self) private var appDelegate

    init() {
        // Without a real .app bundle, the OS treats `swift run` binaries
        // as background helpers — windows materialize but never come to
        // the front, sometimes never become visible at all. Forcing
        // .regular policy + activate(ignoringOtherApps:) at App init
        // gives us a proper foreground app for development. Once the
        // Xcode project lands and a real bundle is produced, this hop
        // becomes unnecessary but harmless.
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some Scene {
        WindowGroup("VibeYTM") {
            RootView()
                .frame(minWidth: 1024, minHeight: 640)
                .environment(bootstrap.playerStore)
                .environment(bootstrap)
                .task {
                    bootstrap.startNowPlayingIntegration()
                    bootstrap.installShutdownHook()
                    bootstrap.installWindowHooks()
                    appDelegate.bootstrap = bootstrap
                }
        }
        .windowStyle(.hiddenTitleBar)
        // App-scoped keyboard shortcuts (#17). Global system-wide
        // shortcuts that work even when the app is in the background
        // would need accessibility permission + an NSEvent.global
        // monitor — we'll add those in a follow-up. App-scoped
        // (Cmd+Shift+Space, Cmd+Opt+Right, Cmd+Opt+Left) cover the
        // common case while VibeYTM is the active app.
        .commands {
            CommandGroup(after: .newItem) {
                Divider()
                Button("Play / Pause") { bootstrap.togglePlay() }
                    .keyboardShortcut(.space, modifiers: [.command, .shift])
                Button("Next Track") { bootstrap.next() }
                    .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
                Button("Previous Track") { bootstrap.previous() }
                    .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
            }
        }
    }
}

/// Owns app-lifetime singletons: the player store, the YTM bridge, and
/// the bridge pipeline state. `@MainActor` because all three touch
/// SwiftUI / WebKit, both of which require the main thread. Composes the
/// `BridgeReducer` per cycle so PlayerCore can stay decoupled from
/// YTMBridge.
@MainActor
@Observable
final class AppBootstrap {
    let playerStore: PlayerStore
    let persistence = PersistenceStore()
    /// The sidebar tab from the persisted snapshot — the view reads
    /// this on first appearance.
    let initialSidebarSelection: SidebarSection
    /// User preferences (#43 / #47) — observable so the Settings page
    /// can bind toggles directly. Mutating either triggers a save.
    var closeToTray: Bool {
        didSet { if oldValue != closeToTray { persistIfMeaningful() } }
    }
    var backgroundPlayback: Bool {
        didSet { if oldValue != backgroundPlayback { persistIfMeaningful() } }
    }
    private var bridge: BridgeHost?
    private var nowPlaying: NowPlayingIntegration?
    private var pipeline = BridgePipelineState()
    /// The volume the user last pushed to YTM via IPC (or the persisted
    /// startup value). Drives `VolumeSettle`'s stored-vs-reported
    /// reconcile.
    private var storedVolume: Double = 1.0
    /// Set on launch from the persisted snapshot. Consumed once the
    /// bridge reports `loggedIn == true` — at that point we navigate
    /// the YTM webview to the saved track at the saved offset, then
    /// clear this so it doesn't fire twice.
    private var pendingResumeVideoId: String?
    private var pendingResumePosition: Double = 0

    init() {
        let store = PlayerStore()
        self.playerStore = store
        let saved = persistence.load()
        self.storedVolume = saved.volume
        self.pendingResumeVideoId = saved.videoId
        self.pendingResumePosition = saved.positionSecs
        self.initialSidebarSelection = SidebarSection(rawValue: saved.sidebarSelection) ?? .home
        self.closeToTray = saved.closeToTray
        self.backgroundPlayback = saved.backgroundPlayback
        // Seed the volume into the player state immediately so the
        // chrome's slider doesn't briefly render at 1.0 on launch.
        var initial = store.state
        initial.volume = saved.volume
        store.apply(initial)
        // Bridge construction lives in a separate method so the closure
        // can safely capture `self` after init — capturing self inside
        // the BridgeHost initializer trips the "used before being
        // initialized" check.
        startBridge()
        // NowPlayingIntegration is started from the WindowGroup's
        // `.task` modifier instead of here. Initializing it inside
        // AppBootstrap.init() — which fires from a SwiftUI @State
        // property initializer — is too early in the launch sequence
        // for `MPRemoteCommandCenter` to attach handlers safely; the
        // first registration trips a libdispatch main-thread assertion
        // before the app's bundle is fully registered with the system
        // media remote daemon. `.task` runs after the scene is on
        // screen, by which point everything is in place.
    }

    /// Called from the WindowGroup's `.task`. Idempotent.
    func startNowPlayingIntegration() {
        guard nowPlaying == nil else { return }
        nowPlaying = NowPlayingIntegration(bootstrap: self)
        // Push current state immediately so the widget doesn't lag a
        // poll cycle behind on first launch.
        nowPlaying?.apply(playerStore.state)
    }

    /// Register a `NSApplication.willTerminateNotification` observer so
    /// the persisted snapshot is flushed synchronously at app exit. The
    /// in-memory throttle drops position updates when the cooldown
    /// hasn't elapsed; without this hook a user who quits within 2 s
    /// of moving the scrubber loses that adjustment on next launch.
    private var shutdownHookInstalled = false
    func installShutdownHook() {
        guard !shutdownHookInstalled else { return }
        shutdownHookInstalled = true
        NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.flushPersistence()
            }
        }
    }

    /// Observe the main window's close notifications so we can pause
    /// playback (#47) when the user has background-playback OFF and
    /// hides the window via close-to-tray. The notification fires
    /// once per close — if close-to-tray is OFF, the app is about to
    /// quit anyway and the pause is a no-op.
    private var windowHooksInstalled = false
    func installWindowHooks() {
        guard !windowHooksInstalled else { return }
        windowHooksInstalled = true
        NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            // Pull the relevant fields off the (non-Sendable) note BEFORE
            // hopping back onto the actor — Swift 6 strict concurrency
            // refuses to capture `note` across the boundary.
            let isMainVisible: Bool = {
                guard let window = note.object as? NSWindow else { return false }
                return window.alphaValue > 0 && window.canBecomeMain
            }()
            guard isMainVisible else { return }
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.closeToTray && !self.backgroundPlayback {
                    self.pause()
                }
            }
        }
    }

    /// Synchronous final write — bypasses the throttle.
    private func flushPersistence() {
        let state = playerStore.state
        let videoId = state.track?.videoId ?? ""
        let snapshot = PersistedState(
            videoId: videoId.isEmpty ? nil : videoId,
            positionSecs: state.positionSecs,
            volume: state.volume,
            sidebarSelection: persistedSidebar,
            closeToTray: closeToTray,
            backgroundPlayback: backgroundPlayback
        )
        persistence.saveImmediate(snapshot)
    }

    private func startBridge() {
        let host = BridgeHost { [weak self] snapshot in
            self?.handle(snapshot: snapshot)
        }
        self.bridge = host
        host.start()
    }

    // MARK: - Player commands (forwarded to BridgeHost)
    //
    // These wrap the BridgeHost command methods so the wiring layer can
    // also update pipeline-state invariants the React/TS tree had to
    // remember by hand. Specifically:
    //   • setVolume — updates VolumeSettle.lastPushAt and storedVolume
    //     so the next 2 s of cycles trust our pushed value over
    //     whatever the bridge reports (issue #76 defense).
    //   • seek — arms SeekFilter so stale POSITION_UPDATED echoes are
    //     dropped during the seek-pending window.
    // Other commands have no pipeline-state side effects yet — the
    // bridge's response feeds back through the next poll cycle.

    func play() { Task { try? await bridge?.play() } }
    func pause() { Task { try? await bridge?.pause() } }
    func togglePlay() { Task { try? await bridge?.togglePlay() } }
    func next() { Task { try? await bridge?.next() } }
    func previous() { Task { try? await bridge?.previous() } }
    func toggleShuffle() { Task { try? await bridge?.toggleShuffle() } }
    func toggleRepeatMode() { Task { try? await bridge?.toggleRepeatMode() } }
    func toggleLike() { Task { try? await bridge?.toggleLike() } }

    func seek(secs: Double) {
        // Arm the seek filter BEFORE firing the IPC so any stale
        // POSITION_UPDATED echoes that arrive from the in-flight poll
        // cycle are filtered.
        let now = Date().timeIntervalSinceReferenceDate
        pipeline.seekFilter = SeekFilterState(
            pending: true,
            lastSeekAt: now,
            target: secs
        )
        Task { try? await bridge?.seek(secs: secs) }
    }

    func setVolume(level: Double) {
        let clamped = min(max(level, 0), 1)
        let now = Date().timeIntervalSinceReferenceDate
        // Arm the volume settle window so the next 2 s of cycles trust
        // our pushed value when the bridge reports something different.
        pipeline.volumeSettle.lastPushAt = now
        storedVolume = clamped
        Task { try? await bridge?.setVolume(level: clamped) }
    }

    /// Start playback from a Home/Explore card. If the card has a
    /// `videoId` we navigate to that track (with an optional playlist
    /// context). If only a `playlistId` is present we navigate to the
    /// playlist's radio. Cards that have neither (browse-only) are
    /// ignored for now — playlist/album browse-detail surfaces land
    /// in a follow-up batch.
    /// Shuffle-then-play — used by the BrowseDetailView header's
    /// Shuffle button. Loads the lead track first, waits for YTM's queue
    /// context to settle (~2 s after navigation), then issues the shuffle
    /// toggle. Without the delay, the toggle either applies to the
    /// previous queue or is silently dropped.
    func shuffleAndPlay(item: ShelfItem) {
        guard bridge != nil else { return }
        play(item: item)
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !playerStore.state.isShuffled {
                toggleShuffle()
            }
        }
    }

    func play(item: ShelfItem) {
        guard let bridge else { return }
        let videoId = item.videoId
        let playlistId = item.playlistId
        guard videoId != nil || playlistId != nil else { return }
        Task {
            if let vid = videoId, !vid.isEmpty {
                // loadVideoById bypasses polymer's click-handler auto-play
                // gate (which checks isTrusted on programmatic clicks and
                // refuses to play). It loads the track AND starts playback
                // in one call. Calling navigate() afterward would race the
                // load — polymer would tear down the player to soft-nav,
                // killing audio. So we ONLY call loadVideoById here.
                try? await bridge.command(
                    "load_video_id",
                    args: ["videoId": vid]
                )
                // Belt-and-suspenders explicit play() shortly after, in
                // case loadVideoById merely cued the track on this YTM
                // build (some experiments cue rather than load).
                try? await Task.sleep(nanoseconds: 800_000_000)
                try? await bridge.play()
            } else if let pid = playlistId, !pid.isEmpty {
                // Playlist with no preview videoId — kick the radio so YTM
                // picks the first track itself.
                try? await bridge.navigate(videoId: "", playlistId: pid)
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                try? await bridge.play()
            }
        }
    }

    // MARK: - Innertube

    /// Fetch the home browse response and parse it into shelves. Returns
    /// an empty array if the bridge isn't ready, the user isn't signed
    /// in, or the response shape doesn't match.
    func getHomeShelves() async -> [Shelf] {
        guard let bridge else { return [] }
        do {
            let data = try await bridge.callYTMAPI(
                endpoint: "browse",
                body: ["browseId": "FEmusic_home"]
            )
            return Innertube.parseShelves(from: data)
        } catch {
            return []
        }
    }

    /// Fetch the explore browse response and parse it into shelves.
    func getExploreShelves() async -> [Shelf] {
        await getBrowseShelves(browseId: "FEmusic_explore")
    }

    func getRecentlyPlayedShelves() async -> [Shelf] {
        await getBrowseShelves(browseId: "FEmusic_history")
    }

    func getLibrarySongsShelves() async -> [Shelf] {
        await getBrowseShelves(browseId: "FEmusic_liked_videos")
    }

    func getLibraryAlbumsShelves() async -> [Shelf] {
        await getBrowseShelves(browseId: "FEmusic_liked_albums")
    }

    func getLibraryArtistsShelves() async -> [Shelf] {
        await getBrowseShelves(browseId: "FEmusic_library_corpus_track_artists")
    }

    func getLibraryPlaylistsShelves() async -> [Shelf] {
        await getBrowseShelves(browseId: "FEmusic_liked_playlists")
    }

    /// Fetch + parse any browseId. Used by the Home/Library wrappers as
    /// well as drill-down detail (album, playlist, artist).
    func getBrowseShelves(browseId: String) async -> [Shelf] {
        guard let bridge else { return [] }
        do {
            let data = try await bridge.callYTMAPI(
                endpoint: "browse",
                body: ["browseId": browseId]
            )
            let shelves = Innertube.parseShelves(from: data)
            // Diagnostic dump: when an empty shelf list comes back, persist
            // the raw response so we can inspect the shape and extend the
            // parser. Filename keyed on browseId (sanitised).
            if shelves.isEmpty {
                let safe = browseId.filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
                try? data.write(to: URL(fileURLWithPath: "/tmp/vibeytm-empty-\(safe.prefix(40)).json"))
            }
            return shelves
        } catch {
            return []
        }
    }

    /// Fetch synced lyrics for a track. Currently only hits lrclib.net
    /// (public API, no auth). YTM's own lyrics tab + Apple Music's
    /// timed lyrics endpoint can be layered as fallbacks later — the
    /// React tree's `get_lyrics` walks all three.
    func getLyrics(for track: Track) async -> Lyrics {
        await LyricsClient.fetchLrclib(
            artist: track.artist,
            title: track.title,
            duration: track.durationSecs
        )
    }

    // MARK: - Library mutations (#54 / #55)

    /// Save / unsave a playlist or album to the user's library. Hits
    /// YTM's `like/like_playlist` Innertube endpoint with one of three
    /// statuses:
    ///   • `LIKE` — add to library
    ///   • `INDIFFERENT` — remove from library
    ///   • `DISLIKE` — unused, but accepted by the endpoint
    /// `target` should be the album's MPRE-prefixed playlistId (the
    /// audio playlist YTM associates with the album page) or the
    /// playlist's normal playlistId. Returns true on success.
    func setSavedToLibrary(playlistId: String, saved: Bool) async -> Bool {
        guard let bridge else { return false }
        let status = saved ? "LIKE" : "INDIFFERENT"
        do {
            _ = try await bridge.callYTMAPI(
                endpoint: "like/like_playlist",
                body: ["target": ["playlistId": playlistId], "status": status]
            )
            return true
        } catch {
            return false
        }
    }

    /// Run a YTM search and parse the result into shelves. When `params`
    /// is supplied, YTM filters results to a single category (Songs,
    /// Albums, Artists, Playlists, Videos). Without it the response
    /// contains the unfiltered "All" view (Top result + each category
    /// in order).
    ///
    /// `params` tokens are stable but version-fragile filter blobs
    /// extracted from YTM's own search-filter chip endpoints. The
    /// values used here are the same ones ytmusicapi ships in its
    /// `SearchFilter` enum.
    func search(query: String, filter: SearchFilter = .all) async -> [Shelf] {
        guard let bridge else { return [] }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        var body: [String: Any] = ["query": trimmed]
        if let params = filter.params {
            body["params"] = params
        }
        do {
            let data = try await bridge.callYTMAPI(
                endpoint: "search",
                body: body
            )
            return Innertube.parseSearchResults(from: data)
        } catch {
            return []
        }
    }

    private func handle(snapshot: BridgePollSnapshot) {
        let now = Date().timeIntervalSinceReferenceDate

        if let bridgeState = snapshot.bridge {
            let outcome = BridgeReducer.reduce(
                previousPlayerState: playerStore.state,
                previousPipeline: pipeline,
                bridge: bridgeState,
                storedVolume: storedVolume,
                now: now
            )
            var next = outcome.nextPlayerState
            // loggedIn + account ride on different JS globals; merge them
            // in here so views can branch on a single PlayerState.
            if let loggedIn = snapshot.loggedIn {
                next.loggedIn = loggedIn
            }
            if let account = snapshot.account {
                next.account = account
            } else if next.loggedIn == false {
                // After sign-out, drop the cached account so the sidebar
                // returns to its "Not signed in" placeholder.
                next.account = nil
            }
            playerStore.apply(next)
            nowPlaying?.apply(next)
            pipeline = outcome.nextPipeline
            consumePendingResumeIfReady()
            persistIfMeaningful()
        } else if snapshot.loggedIn != nil || snapshot.account != nil {
            // No structured state yet (e.g. sign-in page). Surface
            // whatever we got — login flag and/or account — so the UI
            // can switch into the auth flow and keep the avatar fresh.
            var next = playerStore.state
            if let loggedIn = snapshot.loggedIn {
                next.loggedIn = loggedIn
            }
            if let account = snapshot.account {
                next.account = account
            } else if next.loggedIn == false {
                next.account = nil
            }
            playerStore.apply(next)
            nowPlaying?.apply(next)
            consumePendingResumeIfReady()
        }
    }

    /// Fires the persisted-resume IPC once the bridge reports the user
    /// is logged in. One-shot — clears the pending fields so a later
    /// loggedIn=true cycle (after, e.g., a transient logout) doesn't
    /// re-trigger and yank the user back to the saved track.
    private func consumePendingResumeIfReady() {
        guard let videoId = pendingResumeVideoId,
              !videoId.isEmpty,
              playerStore.state.loggedIn == true
        else { return }
        let pos = pendingResumePosition
        pendingResumeVideoId = nil
        pendingResumePosition = 0
        Task { try? await bridge?.navigate(videoId: videoId, positionSecs: pos) }
    }

    private func persistIfMeaningful() {
        // Always persist preferences and sidebar selection — even when no
        // track is loaded yet. The previous guard `!videoId.isEmpty`
        // dropped writes for first-launch sessions where the user
        // toggled a preference before playing anything.
        let state = playerStore.state
        let videoId = state.track?.videoId ?? ""
        let snapshot = PersistedState(
            videoId: videoId.isEmpty ? nil : videoId,
            positionSecs: state.positionSecs,
            volume: state.volume,
            sidebarSelection: persistedSidebar,
            closeToTray: closeToTray,
            backgroundPlayback: backgroundPlayback
        )
        persistence.saveDebounced(snapshot)
    }

    /// The view layer feeds the current sidebar selection in here so
    /// it can land in the persisted snapshot. Called from RootView's
    /// `onChange(of: selection)`.
    var persistedSidebar: String = "home"
    func updatePersistedSidebar(_ section: SidebarSection) {
        persistedSidebar = section.rawValue
        // Persist immediately on selection change; track-position
        // updates handle the rest of the cadence.
        persistIfMeaningful()
    }
}
