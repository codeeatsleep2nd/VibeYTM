# Plan: Sprint 0 — The Spine (VibeYTM 2.0 SwiftUI rewrite)

## Summary

Sprint 0 of the VibeYTM 2.0 SwiftUI rewrite. Adds the architectural foundation that every later sprint depends on: a real `app/VibeYTM.xcodeproj`, `AppRouter` for centralized navigation + sheet ownership, `SharedPlaybackSnapshot` writing to an App Group container for future widgets/Control Center, `DesignTokens.swift` mirroring DESIGN.md OKLCH tokens, the Now Playing artwork fix that works under Swift 6 strict concurrency, hoisting local `@State` out of `RootView`/`PlayerChrome`/etc. into `AppRouter`, and gating the dev-launch hack behind a build flag so the production .app no longer needs it. Logger subsystem migrates from `com.vibeytm.app` to `com.vibeytm.dev` to match the bundle ID.

## User Story

As the VibeYTM developer, I want a stable architectural spine so Sprints 1-6 (parity, Liquid Glass, AppIntents, DJCopilot, widgets, cutover) can build on a real .app bundle with centralized state, instead of layering features onto a `swift run` harness with local `@State` scattered across views.

## Problem → Solution

**Current state:** SwiftUI branch ships ~50 Swift files (~5456 LoC). Audio engine, PlayerCore, BridgeReducer all solid. But:
- App launches via `swift run VibeYTMApp` with a dev-hack at `VibeYTMApp.swift:14` (manual `NSApp.setActivationPolicy(.regular)` + `activate(ignoringOtherApps:)`). Not a real `.app` bundle. No path to widgets, AppIntents, Control Center, notarization.
- Selection/sheet/navigation state lives in local `@State` inside `RootView.swift:11-12` (`selection`, `browseStack`) and `PlayerChrome.swift:20` (`showQueue`). Sprint 3-4 AppIntents can't push deep-links into this state from outside the view tree.
- `NowPlayingIntegration.swift:69` intentionally omits artwork because the Swift 6 strict concurrency + `MPMediaItemArtwork(boundsSize:requestHandler:)` callback fires on a background queue against a `@MainActor` class → libdispatch isolation assertion.
- DESIGN.md uses CSS variables; no Swift mirror file, so every view hardcodes colors inline.
- No App Group container set up, so future widgets have nowhere to read snapshot data from.

**Desired:** Real `app/VibeYTM.xcodeproj` with App Group entitlement, `AppRouter` as the single source of truth for navigation + sheet state, `SharedPlaybackSnapshot` writing to the App Group with cadence rules + Darwin notifications, `DesignTokens.swift` in PlayerCore mirroring DESIGN.md, Sendable artwork pipeline in `NowPlayingIntegration`, all existing views consuming `AppRouter` instead of local `@State`, dev-launch hack behind `#if DEBUG && SPM_DEV_HARNESS` so it auto-disables in Xcode builds.

## Metadata

- **Complexity**: Large
- **Source design doc**: `~/.gstack/projects/codeeatsleep2nd-VibeYTM/dongli-SwiftUI-design-20260516-211903.md`
- **Sprint**: 0 of 6
- **Estimated Files**: 14 created/modified (8 created, 6 modified)
- **Estimated effort**: 1 weekend (8-12 hours)
- **Confidence**: 8/10 — well-specified, but real Xcode project setup has uncertainty

---

## UX Design

### Before (current SwiftUI branch state)

```
~/.app via swift run (dev hack)
   │
   ├─ NSApp.setActivationPolicy(.regular) + activate manually
   │   ↑ workaround at VibeYTMApp.swift:14
   │
   └─ Window opens, but:
       ├─ Now Playing widget (Control Center) shows NO ARTWORK
       │   ↑ NowPlayingIntegration.swift:69 commented out
       ├─ Sidebar selection lives in RootView @State
       │   ↑ external code can't deep-link
       ├─ Queue/Lyrics/Expanded sheets via local @State in chrome
       │   ↑ scattered, no AppIntent can open them
       └─ Logger says com.vibeytm.app but bundle ID will be com.vibeytm.dev
           ↑ Console.app filter inconsistency
```

### After (Sprint 0 ships)

```
/Applications/VibeYTM.app (real .app bundle, ad-hoc signed for dev)
   │
   ├─ Auto-focuses correctly (no manual NSApp dance)
   │
   ├─ Now Playing widget shows ALBUM ARTWORK
   │   ↑ Sendable URLSession → Data → NSImage pipeline
   │
   ├─ AppRouter (@Observable @MainActor) owns:
   │   ├─ browseStack: NavigationPath (deep-link target)
   │   ├─ selection: SidebarSection
   │   ├─ isQueueOpen / isLyricsOpen / isNowPlayingExpanded
   │   └─ handle(deepLink: URL) — future AppIntents call this
   │
   ├─ SharedPlaybackSnapshot at <AppGroup>/snapshot.json
   │   ├─ Written every poll cycle
   │   ├─ Darwin notification on videoId/status/every-N-pos change
   │   └─ WIDGET_RELOAD_THROTTLE_MS = 2000 const for future widgets
   │
   ├─ DesignTokens.swift in PlayerCore
   │   └─ Static enum: Color.surface1 / Space.four / Typography.body
   │
   └─ Logger uses com.vibeytm.dev everywhere (Console.app filter works)
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| App launch | `swift run VibeYTMApp` from terminal | Cmd+R in Xcode, or open `/Applications/VibeYTM.app` | SPM still works via `#if SPM_DEV_HARNESS` flag |
| Now Playing widget artwork | Generic music icon | Real cover art | Verify via Control Center + Notification Center |
| Sidebar selection persistence | `@State` in RootView, lost on tap | Owned by AppRouter, future-persistable via Codable | No user-visible change yet |
| Opening queue panel from PlayerChrome | `showQueue: Bool` local `@State` | `router.isQueueOpen = true` | Closure dismissal pattern preserved |
| NowPlayingExpanded dismissal | 5 redundant paths (chevron / Done / backdrop tap / Esc / router) | Same 5 paths, but `router.dismissNowPlayingExpanded()` is the canonical method | Contract test guards this |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `~/.gstack/projects/codeeatsleep2nd-VibeYTM/dongli-SwiftUI-design-20260516-211903.md` | Sprint 0 section | The source of truth for everything in this plan |
| P0 | `app/SWIFTUI_CHECKLIST.md` | full | Bridge-side regression rules; every Sprint 0 view refactor must respect them |
| P0 | `app/VibeYTMApp/Sources/VibeYTMApp/VibeYTMApp.swift` | 1-50 | The dev-launch hack lives at line 14; must move it behind build flag without breaking SPM dev workflow |
| P0 | `app/VibeYTMApp/Sources/VibeYTMApp/RootView.swift` | 1-50 | `selection` (line 11) + `browseStack` (line 12) are the @State vars to hoist into AppRouter |
| P0 | `app/VibeYTMApp/Sources/VibeYTMApp/PlayerChrome.swift` | 17-30 | `showQueue` @State (line 20) to hoist; also where Vibe pill button lands later |
| P0 | `app/VibeYTMApp/Sources/VibeYTMApp/NowPlayingExpanded.swift` | 41-150 | DISMISSAL CONTRACT — 5 redundant paths; refactor must preserve all 5 |
| P0 | `app/VibeYTMApp/Sources/VibeYTMApp/NowPlayingIntegration.swift` | 60-95 | The intentionally-commented artwork branch; replace with Sendable pipeline |
| P0 | `app/VibeYTMApp/Sources/VibeYTMApp/VibeYTMAppDelegate.swift` | full | Hook point for Darwin notification observer install |
| P0 | `DESIGN.md` | 659-749 (Design Tokens section) | Source of truth for DesignTokens.swift contents |
| P1 | `app/VibeYTMApp/Sources/VibeYTMApp/LyricsPanel.swift` | 1-30 | Reads `dismiss` from environment; AppRouter migration target |
| P1 | `app/VibeYTMApp/Sources/VibeYTMApp/QueuePanel.swift` | 1-30 | Reads `dismiss` from environment; AppRouter migration target |
| P1 | `app/VibeYTMApp/Package.swift` | full | Add `swiftSettings: [.define("SPM_DEV_HARNESS", .when(configuration: .debug))]` |
| P1 | `app/Packages/PlayerCore/Package.swift` | full | DesignTokens.swift lands in PlayerCore, no new dependencies needed |
| P1 | `app/Packages/PlayerCore/Tests/PlayerCoreTests/PlayerStateTests.swift` | full | Test pattern reference for the new test suites |
| P2 | `app/Packages/YTMBridge/Sources/YTMBridge/ImageCache.swift` | full | Reuse for artwork URL → Data prefetch in NowPlayingIntegration |
| P2 | `app/Packages/YTMBridge/Sources/YTMBridge/SeekFilter.swift` | full | Test/validator pattern reference for new modules |

---

## Patterns to Mirror

| Pattern | Reference file | Why |
|---|---|---|
| `@Observable @MainActor` state container | `app/Packages/PlayerCore/Sources/PlayerCore/PlayerStore.swift` | AppRouter is the same shape |
| Codable struct for cross-process state | `app/VibeYTMApp/Sources/VibeYTMApp/PersistenceStore.swift` (`PersistedState`) | SharedPlaybackSnapshot has the same shape |
| `Logger(subsystem:category:)` initialization | Top of `app/VibeYTMApp/Sources/VibeYTMApp/VibeYTMApp.swift` | Replicate, change subsystem to `com.vibeytm.dev` |
| Swift Testing `@Test` suites | `app/Packages/YTMBridge/Tests/YTMBridgeTests/SeekFilterTests.swift` | New test files follow this pattern |
| CLT validator for pure logic | `app/Packages/YTMBridge/Sources/SeekFilterValidator/main.swift` | Optional: AppRouter URL parser could get a validator |
| Throttle pattern (cooldown-based) | `app/VibeYTMApp/Sources/VibeYTMApp/PersistenceStore.swift` | SharedPlaybackSnapshot uses same throttle |

---

## GOTCHAs (regression traps + Swift 6 concurrency)

1. **Do NOT use `@Environment(\.dismiss)` in `NowPlayingExpanded`.** It silently fails inside sheets with focus modifiers. AppRouter migration must keep the explicit `onDismiss` closure pattern — see `NowPlayingExpanded.swift` DISMISSAL CONTRACT comment.

2. **Do NOT just uncomment the artwork branch in `NowPlayingIntegration.swift:69`.** Swift 6 strict concurrency + `MPMediaItemArtwork(boundsSize:requestHandler:)` callback on a background queue against a `@MainActor` class will trip `libdispatch isolation assertion`. Use the Sendable pipeline: prefetch `Data` via `URLSession`, capture only `Data` (or pre-built `NSImage`) in the `requestHandler` closure with no captured `self`.

3. **`MainActor.run { try await ... }` is the WRONG shape.** If `BridgeHost.play(videoId:)` is `@MainActor async`, just `try await bridgeHost.play(...)` from any non-isolated context auto-hops. `MainActor.run` is for hopping synchronous blocks.

4. **`SPM_DEV_HARNESS` flag MUST only be defined in `app/VibeYTMApp/Package.swift`**, NOT in the Xcode project. Use `.define("SPM_DEV_HARNESS", .when(configuration: .debug))`. Xcode project omits the define so the dev hack auto-disables in real .app builds.

5. **Bundle ID stays `com.vibeytm.dev`** (matches the Tauri build's `WKWebsiteDataStore` cookie storage). Changing it would force every existing user to re-sign-in to YouTube Music.

6. **`NSFileCoordinator` is the right cross-process atomicity primitive for command files**, NOT `PIPE_BUF` (which is for pipes/FIFOs only). Even though Sprint 0 doesn't write commands yet (Sprint 4 does), the `SharedPlaybackSnapshot` write should use `NSFileCoordinator(filePresenter:).coordinate(writingItemAt:)` to be safe when widgets read.

7. **`NavigationPath` is type-erased** — `Hashable` destinations work, but persisting requires `Codable` versions. Sprint 0 doesn't need persistence yet; keep `BrowseDestination` `Hashable` only for now.

8. **App Group entitlement requires Apple Developer Program** ($99/yr) to ship to other users. For Sprint 0 local dev, the free personal team is sufficient — Xcode auto-provisions the App Group entitlement under the personal team for development builds.

9. **Logger subsystem migration: change EVERY occurrence in one commit.** Half-migrated logs make Console.app filtering confusing. Grep for `Logger(subsystem: "com.vibeytm.app"` and replace globally.

10. **Preserve the `@Observable` macro behavior** — don't switch to `ObservableObject`. macOS 26 / Swift 6.2 idiomatic is `@Observable` + `@Environment(AppRouter.self)`.

---

## Files to Change

### Created (8)

| File | Purpose |
|---|---|
| `app/VibeYTM.xcodeproj/project.pbxproj` (+ schemes) | Real Xcode project with app target + SPM dependencies on YTMBridge/PlayerCore; bundle ID `com.vibeytm.dev`; entitlement file references |
| `app/VibeYTM.entitlements` | App Group `group.com.vibeytm.dev`, Network Client (already exists ad-hoc at `app/build/VibeYTM.entitlements` — promote to real entitlement file) |
| `app/VibeYTMApp/Sources/VibeYTMApp/AppRouter.swift` | `@Observable @MainActor` class owning navigation + sheet state; `AppRoute` enum; `handle(deepLink:)` parser |
| `app/VibeYTMApp/Sources/VibeYTMApp/SharedPlaybackSnapshot.swift` | Codable struct + write cadence + Darwin notification + `WIDGET_RELOAD_THROTTLE_MS` constant |
| `app/Packages/PlayerCore/Sources/PlayerCore/DesignTokens.swift` | Static enum namespace mirroring DESIGN.md OKLCH colors / spacing / typography |
| `app/VibeYTMApp/Tests/AppRouterTests.swift` | URL parser round-trips, navigate(to:) mutates correctly, malformed URL → no-op |
| `app/VibeYTMApp/Tests/SharedPlaybackSnapshotTests.swift` | Codable round-trip, cadence rules, throttle constants |
| `app/VibeYTMApp/Tests/NowPlayingExpandedDismissalContractTests.swift` | **CRITICAL regression** — 5 dismissal paths each work independently |

### Modified (6)

| File | Change |
|---|---|
| `app/VibeYTMApp/Package.swift` | Add `swiftSettings: [.define("SPM_DEV_HARNESS", .when(configuration: .debug))]` to executableTarget |
| `app/VibeYTMApp/Sources/VibeYTMApp/VibeYTMApp.swift` | Inject `AppRouter` into environment; gate dev-launch hack behind `#if DEBUG && SPM_DEV_HARNESS`; install Darwin notification observers; Logger subsystem → `com.vibeytm.dev` |
| `app/VibeYTMApp/Sources/VibeYTMApp/RootView.swift` | Replace local `@State selection` + `browseStack` with `@Environment(AppRouter.self)`; bind `NavigationStack(path: $router.browseStack)` |
| `app/VibeYTMApp/Sources/VibeYTMApp/PlayerChrome.swift` | Replace `showQueue: Bool` @State with `@Environment(AppRouter.self)` reading `router.isQueueOpen` |
| `app/VibeYTMApp/Sources/VibeYTMApp/NowPlayingExpanded.swift` | Preserve 5-path dismissal contract; `router.dismissNowPlayingExpanded()` is the canonical method, but closure pattern stays |
| `app/VibeYTMApp/Sources/VibeYTMApp/NowPlayingIntegration.swift` | Replace lines 69-79 with Sendable artwork pipeline (URLSession → Data → NSImage in requestHandler) |

---

## Step-by-Step Tasks

### Task 1: Create Xcode project (app target + entitlements + SPM deps)

**MIRROR:** `app/VibeYTMApp/Package.swift` for the target/dependency shape; existing `app/build/VibeYTM.entitlements` for entitlements content.

**Action:** Open Xcode 26. File → New → Project → macOS → App. Bundle ID: `com.vibeytm.dev`. Target name: `VibeYTM`. Save to `app/VibeYTM.xcodeproj`. Then:
- Replace the auto-generated `Sources/` with the existing `app/VibeYTMApp/Sources/VibeYTMApp/` path
- Add SPM dependencies: `app/Packages/YTMBridge` and `app/Packages/PlayerCore` (local file paths)
- Add entitlements file `app/VibeYTM.entitlements` with: App Group `group.com.vibeytm.dev`, Network Client, no sandbox (per OQ1 — sandbox off for v2.0)
- Signing & Capabilities: select the free personal team for dev signing
- Scheme: ensure `VibeYTM` builds and runs

**GOTCHA:** Don't let Xcode regenerate Info.plist with wrong bundle ID. Set bundle ID to `com.vibeytm.dev` BEFORE first build.

**IMPORTS:** N/A (project file)

**Validate:** Cmd+R in Xcode → app launches from `~/Library/Developer/...`, sidebar visible, traffic lights working.

### Task 2: Add `DesignTokens.swift` to PlayerCore

**MIRROR:** `app/Packages/PlayerCore/Sources/PlayerCore/Track.swift` for the file structure / module access.

**Action:** Create `app/Packages/PlayerCore/Sources/PlayerCore/DesignTokens.swift`. Mirror DESIGN.md OKLCH tokens as a static enum namespace:

```swift
import SwiftUI

public enum DesignTokens {
    public enum Color {
        public static let bg = SwiftUI.Color(red: 0.05, green: 0.05, blue: 0.07)  // OKLCH 10% 0.015 270
        public static let surface1 = SwiftUI.Color(red: 0.10, green: 0.10, blue: 0.12)  // OKLCH 14% 0.015 270
        public static let surface2 = SwiftUI.Color(red: 0.14, green: 0.14, blue: 0.16)  // OKLCH 18% 0.012 270
        public static let surface3 = SwiftUI.Color(red: 0.18, green: 0.18, blue: 0.20)  // OKLCH 22% 0.010 270
        public static let textPrimary = SwiftUI.Color(white: 0.95)
        public static let textSecondary = SwiftUI.Color(white: 0.65)
        public static let textTertiary = SwiftUI.Color(white: 0.45)
        public static let accent = SwiftUI.Color(red: 1.0, green: 0.0, blue: 0.0)  // YouTube red, OKLCH 65% 0.20 25
        public static let border = SwiftUI.Color(white: 0.25, opacity: 0.5)
        public static let highlight = SwiftUI.Color(white: 0.30, opacity: 0.7)
        public static let danger = SwiftUI.Color(red: 0.95, green: 0.18, blue: 0.18)
    }
    public enum Space {
        public static let one: CGFloat = 4
        public static let two: CGFloat = 8
        public static let three: CGFloat = 12
        public static let four: CGFloat = 16
        public static let five: CGFloat = 20
        public static let six: CGFloat = 24
        public static let eight: CGFloat = 32
        public static let ten: CGFloat = 40
        public static let twelve: CGFloat = 48
        public static let sixteen: CGFloat = 64
    }
    public enum Typography {
        public static let xs = SwiftUI.Font.system(size: 11)
        public static let sm = SwiftUI.Font.system(size: 13)
        public static let base = SwiftUI.Font.system(size: 15)
        public static let lg = SwiftUI.Font.system(size: 18, weight: .semibold)
        public static let xl = SwiftUI.Font.system(size: 24, weight: .semibold)
        public static let xxl = SwiftUI.Font.system(size: 32, weight: .bold)
    }
    public enum Glass {
        public static let blurRadius: CGFloat = 20
    }
    public enum Layout {
        public static let sidebarWidth: CGFloat = 240
        public static let sidebarCollapsed: CGFloat = 64
        public static let nowPlayingWidth: CGFloat = 320
    }
}
```

**GOTCHA:** Swift's `Color(red:green:blue:)` is sRGB. DESIGN.md uses OKLCH. Approximations are fine for v2.0; a precise OKLCH→sRGB converter can land in v2.1 if color drift is noticeable.

**IMPORTS:** `import SwiftUI`

**Validate:** `cd app/Packages/PlayerCore && swift build` succeeds. `cd app/Packages/PlayerCore && swift test` still passes (no behavior change).

### Task 3: Add `AppRouter.swift`

**MIRROR:** `app/Packages/PlayerCore/Sources/PlayerCore/PlayerStore.swift` for `@Observable @MainActor` class shape.

**Action:** Create `app/VibeYTMApp/Sources/VibeYTMApp/AppRouter.swift`:

```swift
import SwiftUI
import PlayerCore

public enum AppRoute: Hashable, Sendable {
    case sidebar(SidebarSection)
    case browse(BrowseDestination)
    case queue
    case lyrics
    case nowPlayingExpanded
    case search(query: String)
    case djCopilot(prompt: String?)
    case playTrack(videoId: String)
    case openAlbum(browseId: String)
    case openPlaylist(browseId: String)
    case openArtist(browseId: String)
}

@Observable
@MainActor
public final class AppRouter {
    public var selection: SidebarSection = .home
    public var browseStack = NavigationPath()
    public var isQueueOpen = false
    public var isLyricsOpen = false
    public var isNowPlayingExpanded = false

    public init() {}

    public func navigate(to route: AppRoute) {
        switch route {
        case .sidebar(let section):
            selection = section
        case .browse(let dest):
            browseStack.append(dest)
        case .queue:
            isQueueOpen = true
        case .lyrics:
            isLyricsOpen = true
        case .nowPlayingExpanded:
            isNowPlayingExpanded = true
        case .search(let query):
            selection = .search
            // SearchView reads `query` from its own state; AppIntent-driven
            // pre-fill lands in a follow-up if needed
        case .djCopilot:
            // Future: Sprint 4 wires the Vibe sheet to a router flag
            break
        case .playTrack:
            // Future: Sprint 3 AppIntents call into BridgeHost directly;
            // this case stays here for reference but is a no-op for now
            break
        case .openAlbum(let browseId):
            browseStack.append(BrowseDestination.album(browseId: browseId))
        case .openPlaylist(let browseId):
            browseStack.append(BrowseDestination.playlist(browseId: browseId))
        case .openArtist(let browseId):
            browseStack.append(BrowseDestination.artist(browseId: browseId))
        }
    }

    public func handle(deepLink url: URL) {
        guard url.scheme == "vibeytm" else { return }
        guard let host = url.host else { return }
        switch host {
        case "track":
            let id = url.lastPathComponent
            if !id.isEmpty { navigate(to: .playTrack(videoId: id)) }
        case "album":
            let id = url.lastPathComponent
            if !id.isEmpty { navigate(to: .openAlbum(browseId: id)) }
        case "playlist":
            let id = url.lastPathComponent
            if !id.isEmpty { navigate(to: .openPlaylist(browseId: id)) }
        case "artist":
            let id = url.lastPathComponent
            if !id.isEmpty { navigate(to: .openArtist(browseId: id)) }
        case "queue":
            navigate(to: .queue)
        case "vibe":
            let prompt = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "prompt" })?.value
            navigate(to: .djCopilot(prompt: prompt))
        default:
            break  // unknown host → no-op (don't crash)
        }
    }

    public func dismissNowPlayingExpanded() {
        isNowPlayingExpanded = false
    }
    public func dismissQueue() { isQueueOpen = false }
    public func dismissLyrics() { isLyricsOpen = false }
}
```

**GOTCHA:** Use `NavigationPath`, not `[BrowseDestination]`. NavigationPath is what SwiftUI's `NavigationStack(path:)` expects natively. AppIntent-driven `append(destination)` and user-driven NavigationLink push both flow through the same observable.

**IMPORTS:** `import SwiftUI`, `import PlayerCore`

**Validate:** `cd app/VibeYTMApp && swift build` succeeds. AppRouterTests run green (added in Task 8).

### Task 4: Add `SharedPlaybackSnapshot.swift`

**MIRROR:** `app/VibeYTMApp/Sources/VibeYTMApp/PersistenceStore.swift` for the throttle + write pattern; `PersistedState` for Codable shape.

**Action:** Create `app/VibeYTMApp/Sources/VibeYTMApp/SharedPlaybackSnapshot.swift`:

```swift
import Foundation
import OSLog
import PlayerCore

private let snapshotLog = Logger(subsystem: "com.vibeytm.dev", category: "Snapshot")

/// Cross-process playback snapshot. Written to the App Group container
/// (`group.com.vibeytm.dev`) so widgets, Control Center, and AppIntents
/// extensions can read the current track state without IPC into the host.
///
/// Write cadence (every poll cycle from AppBootstrap.handle(snapshot:)):
///   - Always rewrite the file (Codable JSON).
///   - Post `com.vibeytm.dev.snapshot-updated` Darwin notification only on:
///     • videoId change
///     • status change (playing ↔ paused ↔ buffering)
///     • Every Nth poll cycle for position updates (default N=20 → ~3 s)
///
/// Widget extensions observe the Darwin notification and call
/// `WidgetCenter.shared.reloadAllTimelines()`, throttled by
/// WIDGET_RELOAD_THROTTLE_MS to prevent OS rate-limiting.
public struct SharedPlaybackSnapshot: Codable, Sendable {
    public let videoId: String?
    public let title: String
    public let artist: String
    public let album: String
    public let durationSecs: Double
    public let positionSecs: Double
    public let status: String  // "playing" / "paused" / "buffering" / "idle"
    public let artworkURL: String?
    public let timestamp: Date

    public init(state: PlayerState) {
        self.videoId = state.currentTrack?.videoId
        self.title = state.currentTrack?.title ?? ""
        self.artist = state.currentTrack?.artist ?? ""
        self.album = state.currentTrack?.album ?? ""
        self.durationSecs = state.currentTrack?.durationSecs ?? 0
        self.positionSecs = state.positionSecs
        self.status = String(describing: state.status)
        self.artworkURL = state.currentTrack?.artworkURL
        self.timestamp = Date()
    }
}

public enum SharedPlaybackSnapshotConstants {
    /// App Group identifier — must match entitlement file
    public static let appGroup = "group.com.vibeytm.dev"
    /// Snapshot filename inside the App Group container
    public static let filename = "snapshot.json"
    /// Darwin notification name for snapshot updates
    public static let notificationName = "com.vibeytm.dev.snapshot-updated"
    /// Position-change throttling: notify only every Nth poll cycle
    public static let notifyEveryNPolls = 20
    /// Widget reload throttle (widgets honor this)
    public static let widgetReloadThrottleMs = 2000
}

@MainActor
public final class SharedPlaybackSnapshotWriter {
    private var lastVideoId: String?
    private var lastStatus: String?
    private var pollsSinceLastNotify = 0

    public init() {}

    public func write(_ snapshot: SharedPlaybackSnapshot) {
        guard let url = containerURL() else {
            snapshotLog.error("App Group container missing — entitlement?")
            return
        }
        let fileURL = url.appendingPathComponent(SharedPlaybackSnapshotConstants.filename)
        do {
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            snapshotLog.error("Snapshot write failed: \(error.localizedDescription)")
            return
        }

        let shouldNotify = decideNotify(snapshot)
        if shouldNotify {
            postDarwinNotification()
            pollsSinceLastNotify = 0
        } else {
            pollsSinceLastNotify += 1
        }
        lastVideoId = snapshot.videoId
        lastStatus = snapshot.status
    }

    private func decideNotify(_ snapshot: SharedPlaybackSnapshot) -> Bool {
        if snapshot.videoId != lastVideoId { return true }
        if snapshot.status != lastStatus { return true }
        if pollsSinceLastNotify >= SharedPlaybackSnapshotConstants.notifyEveryNPolls { return true }
        return false
    }

    private func containerURL() -> URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SharedPlaybackSnapshotConstants.appGroup
        )
    }

    private func postDarwinNotification() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(SharedPlaybackSnapshotConstants.notificationName as CFString),
            nil, nil, true
        )
    }
}
```

**GOTCHA:** App Group container URL returns nil if the entitlement isn't provisioned. Log + skip the write — don't crash. The widget will fall back to placeholder until the container exists.

**IMPORTS:** `import Foundation`, `import OSLog`, `import PlayerCore`

**Validate:** `swift build` succeeds. SharedPlaybackSnapshotTests run green (added in Task 8). Manual check: launch the app, play a song, verify `<AppGroup>/snapshot.json` exists and contains the current track.

### Task 5: Fix Now Playing artwork (Sendable pipeline)

**MIRROR:** Existing `URLSession.shared` usage in `NowPlayingIntegration.swift` for the prefetch pattern; `YTMBridge.ImageCache` for capture-pattern reference.

**Action:** Edit `app/VibeYTMApp/Sources/VibeYTMApp/NowPlayingIntegration.swift` lines 69-79. Replace the commented-out artwork branch with a Sendable pipeline. Approximate shape:

```swift
// At the top of the apply(_:) function, BEFORE building the info dict:
let artworkData: Data? = await prefetchArtworkData(from: track.artworkURL)

// Then in the info dict construction:
if let data = artworkData, let image = NSImage(data: data) {
    let artwork = MPMediaItemArtwork(boundsSize: image.size) { requestedSize in
        // requestHandler closure: capture only `image`, no `self`
        return image
    }
    info[MPMediaItemPropertyArtwork] = artwork
}

// New helper function elsewhere in the file:
private func prefetchArtworkData(from urlString: String?) async -> Data? {
    guard let urlString, let url = URL(string: urlString) else { return nil }
    do {
        let (data, _) = try await URLSession.shared.data(from: url)
        return data
    } catch {
        return nil  // fall through to no-artwork
    }
}
```

**GOTCHA:** `requestHandler` may fire multiple times for multiple `boundsSize` requests. Returning the same pre-fetched `NSImage` is acceptable for a cover-art image (the OS scales it). If artifacts appear later, derive per-size renders inside the closure. DO NOT capture `self` in the closure — that's the original Swift 6 isolation crash.

**IMPORTS:** existing imports (Foundation, MediaPlayer, AppKit) cover it

**Validate:** Build succeeds. Launch the app, play a song, check Control Center / Notification Center → cover art appears, not the generic music icon.

### Task 6: Hoist local @State into AppRouter

**MIRROR:** Per-view: read the current local @State usage, replace with `@Environment(AppRouter.self)`.

**Action:** Edit five files in sequence:

#### 6a. `app/VibeYTMApp/Sources/VibeYTMApp/VibeYTMApp.swift`
- Replace the dev-launch hack body with `#if DEBUG && SPM_DEV_HARNESS ... #endif`.
- Inject `AppRouter` into the environment from the scene:
  ```swift
  @State private var router = AppRouter()
  @State private var snapshotWriter = SharedPlaybackSnapshotWriter()
  // ...
  WindowGroup {
      RootView()
          .environment(router)
          .environment(snapshotWriter)
          .onOpenURL { url in router.handle(deepLink: url) }
  }
  ```
- Update the `Logger(subsystem: "com.vibeytm.app", category: "AppBootstrap")` at the top to `"com.vibeytm.dev"`. Grep for all other Logger subsystem strings and update them too.
- Hook `AppBootstrap.handle(snapshot:)` to also call `snapshotWriter.write(SharedPlaybackSnapshot(state: newState))` after `playerStore.apply()`.

#### 6b. `app/VibeYTMApp/Sources/VibeYTMApp/RootView.swift`
- Remove `@State private var selection: SidebarSection` (line 11) and `@State private var browseStack: [BrowseDestination]` (line 12).
- Add `@Environment(AppRouter.self) private var router`.
- Replace `selection` and `browseStack` reads with `router.selection` and `router.browseStack`.
- Bind `NavigationStack(path: $router.browseStack)`.

#### 6c. `app/VibeYTMApp/Sources/VibeYTMApp/PlayerChrome.swift`
- Remove `@State private var showQueue = false` (line 20).
- Add `@Environment(AppRouter.self) private var router`.
- Replace `showQueue` reads/writes with `router.isQueueOpen`.
- Queue button action becomes `{ router.isQueueOpen = true }`.

#### 6d. `app/VibeYTMApp/Sources/VibeYTMApp/NowPlayingExpanded.swift`
- DO NOT remove the `onDismiss` closure parameter or the 5-path dismissal pattern. Preserve every comment in the DISMISSAL CONTRACT block.
- Just ensure the closure called by the caller (RootView) flips `router.isNowPlayingExpanded = false` via `router.dismissNowPlayingExpanded()`.
- Local `@Environment(\.dismiss)` is STILL NOT USED. Keep the closure pattern.

#### 6e. `app/VibeYTMApp/Sources/VibeYTMApp/LyricsPanel.swift` and `QueuePanel.swift`
- Same pattern: replace `@Environment(\.dismiss)` with router-flag flip via callback.

**GOTCHA:** The closure-based dismissal in `NowPlayingExpanded` is a regression-protected contract. Don't switch to `@Environment(\.dismiss)` to "clean up the code" — it has historically failed silently with focus modifiers.

**IMPORTS:** Each modified file: add `import PlayerCore` if not already present (AppRouter lives in VibeYTMApp module, so no extra import needed for the app target).

**Validate:** Build succeeds. Manual: launch app, click Queue button → queue panel opens; close → opens. Click chevron in NowPlayingExpanded → dismisses. Press Esc → dismisses. Each of the 5 paths still works.

### Task 7: Update `app/VibeYTMApp/Package.swift` build flag

**MIRROR:** Existing `Package.swift` shape.

**Action:** Edit `app/VibeYTMApp/Package.swift`. Modify the executableTarget:

```swift
.executableTarget(
    name: "VibeYTMApp",
    dependencies: [
        .product(name: "YTMBridge", package: "YTMBridge"),
        .product(name: "PlayerCore", package: "PlayerCore"),
    ],
    swiftSettings: [
        .define("SPM_DEV_HARNESS", .when(configuration: .debug))
    ]
)
```

**GOTCHA:** Only define when SPM is the builder. Xcode project does NOT add this swiftSettings definition, so production builds automatically skip the dev-launch hack body.

**IMPORTS:** N/A (Package.swift)

**Validate:** `swift run VibeYTMApp` still works for dev iteration. Xcode-built .app does NOT trigger the dev hack (verify the manual `NSApp.setActivationPolicy(.regular)` block doesn't run).

### Task 8: Add Swift Testing suites

**MIRROR:** `app/Packages/YTMBridge/Tests/YTMBridgeTests/SeekFilterTests.swift` for `@Test` shape.

**Action:** Create three test files:

#### 8a. `app/VibeYTMApp/Tests/AppRouterTests.swift`
Test cases (use `@Test` per case):
- Each of the 10 AppRoute cases round-trips through `navigate(to:)` and mutates the expected state.
- Deep-link grammar: `vibeytm://track/abc123` → `AppRoute.playTrack(videoId: "abc123")` triggers correctly.
- Malformed URL (`vibeytm://garbage`) → no-op, no crash.
- Non-vibeytm URL (`https://example.com`) → no-op.
- `dismissNowPlayingExpanded()` / `dismissQueue()` / `dismissLyrics()` flip flags correctly.
- `browseStack.append` works for all 4 destination types (album, playlist, artist, generic browse).

#### 8b. `app/VibeYTMApp/Tests/SharedPlaybackSnapshotTests.swift`
Test cases:
- Codable round-trip: encode → decode → equal.
- `SharedPlaybackSnapshot.init(state:)` populates all fields from a sample PlayerState.
- `SharedPlaybackSnapshotWriter.decideNotify` returns true on videoId change, status change, or every Nth poll.
- `SharedPlaybackSnapshotWriter.decideNotify` returns false when position changes within the throttle window.
- `notifyEveryNPolls = 20` constant is honored exactly.
- App Group container URL returns nil gracefully when entitlement missing (mocked via dependency injection of FileManager).

#### 8c. `app/VibeYTMApp/Tests/NowPlayingExpandedDismissalContractTests.swift`
**CRITICAL regression test.** 5 cases, each verifies one dismissal path in isolation:
- chevron-down button click → `onDismiss` invoked
- Done button click → `onDismiss` invoked
- backdrop tap → `onDismiss` invoked
- Esc keyDown via local NSEvent monitor → `onDismiss` invoked
- explicit `router.dismissNowPlayingExpanded()` call → flag flips, sheet dismisses

Test the closure pattern: assert that switching to `@Environment(\.dismiss)` would FAIL the contract (via a documented anti-test that proves the closure approach is intentional).

**GOTCHA:** Swift Testing's `@MainActor` annotation on the suite/test is required for any test that touches AppRouter or SwiftUI types.

**IMPORTS:** `import Testing`, `import SwiftUI`, `import PlayerCore`, `@testable import VibeYTMApp`

**Validate:**
- `cd app/Packages/PlayerCore && swift test`
- `cd app/Packages/YTMBridge && swift test`
- `cd app/VibeYTMApp && swift test` (will likely need a small `Package.swift` addition for the test target; create `Tests/` directory at the package root if needed)

---

## Validation Commands

### Level 1: Static Analysis

```bash
# Type-check via SPM build
cd app/Packages/PlayerCore && swift build 2>&1 | tail -20
cd app/Packages/YTMBridge && swift build 2>&1 | tail -20
cd app/VibeYTMApp && swift build 2>&1 | tail -20
```

Zero errors required. SwiftLint not currently configured in the repo — skip lint.

### Level 2: Unit Tests

```bash
cd app/Packages/PlayerCore && swift test
cd app/Packages/YTMBridge && swift test
cd app/VibeYTMApp && swift test  # after Task 8 adds Tests/
```

All tests green. New tests from Task 8: AppRouterTests (10+ cases), SharedPlaybackSnapshotTests (6+ cases), NowPlayingExpandedDismissalContractTests (5 cases — CRITICAL).

### Level 3: Build Check

```bash
# Xcode build (after Task 1 lands the .xcodeproj):
xcodebuild -project app/VibeYTM.xcodeproj -scheme VibeYTM -configuration Debug build 2>&1 | tail -30

# SPM build (for dev harness):
cd app/VibeYTMApp && swift build
```

Both must succeed.

### Level 4: Integration / Manual

```bash
# Launch the app from Xcode (Cmd+R) or via:
open app/VibeYTM.xcodeproj
```

Manual checks (the things tests can't verify):
1. App launches from `/Applications/VibeYTM.app` (after Archive + Copy) — focuses correctly, no manual NSApp dance.
2. Play a song → Control Center music tile shows cover art (not generic icon).
3. Play a song → macOS Now Playing widget shows cover art.
4. Console.app filter `subsystem:com.vibeytm.dev` returns log entries (not the old `com.vibeytm.app`).
5. Click Queue button → opens; close → closes. Same for Lyrics and NowPlayingExpanded.
6. NowPlayingExpanded dismissal: try each of the 5 paths — each works.
7. `swift run VibeYTMApp` still works for SPM dev iteration (dev-launch hack still fires under SPM).
8. Run app from Xcode → dev-launch hack does NOT fire (no SPM_DEV_HARNESS define).
9. App Group container exists at `~/Library/Group Containers/group.com.vibeytm.dev/` after first launch.
10. Snapshot file at `~/Library/Group Containers/group.com.vibeytm.dev/snapshot.json` updates while playing.

### Level 5: Edge Case Testing

- Cold launch with no track ever played → SharedPlaybackSnapshot writer doesn't crash; widget reads nil gracefully (future widget — for Sprint 0, just verify the writer doesn't crash on no-current-track).
- Deep link `vibeytm://garbage` → app doesn't crash.
- Deep link `vibeytm://track/` (empty videoId) → no-op, no navigation.
- NowPlayingExpanded sheet open + click backdrop multiple times rapidly → dismissal idempotent.
- Switch sidebar selection while NowPlayingExpanded is open → expanded sheet stays (router flag isolated from selection).

---

## Acceptance Criteria

Sprint 0 ships when ALL of the following are true:

- [ ] `app/VibeYTM.xcodeproj` exists, builds, runs via Cmd+R in Xcode 26.
- [ ] App Group entitlement `group.com.vibeytm.dev` provisioned under personal team (Apple ID).
- [ ] `AppRouter` exists, all existing views read from it, no local `@State` for navigation/sheet state remains in views (except `NowPlayingExpanded` dismissal closure pattern).
- [ ] `SharedPlaybackSnapshot` writer runs on every poll cycle; Darwin notification posted on videoId/status change.
- [ ] `DesignTokens.swift` in PlayerCore mirrors DESIGN.md tokens.
- [ ] Now Playing widget shows cover artwork (visually verified in Control Center).
- [ ] Console.app `subsystem:com.vibeytm.dev` filter returns log entries.
- [ ] Dev-launch hack at `VibeYTMApp.swift:14` is gated behind `#if DEBUG && SPM_DEV_HARNESS`.
- [ ] `swift run VibeYTMApp` still works for SPM dev iteration.
- [ ] `swift test` passes on all three packages: PlayerCore, YTMBridge, VibeYTMApp.
- [ ] AppRouterTests covers all 10 AppRoute cases + URL parser edge cases.
- [ ] NowPlayingExpandedDismissalContractTests covers all 5 dismissal paths.
- [ ] All 8 manual checks in Level 4 pass.

## NOT in scope for Sprint 0

- Apple Developer Program ($99/yr) — only needed for Sprint 6 cutover.
- Notarization — explicitly out per OQ1.
- Sparkle updater — out per eng-review D5.
- Widget extension targets — Sprint 4.
- AppIntents extension target — Sprint 3.
- DJCopilot package — Sprint 4.
- DesignTokens runtime-color OKLCH→sRGB precise conversion — v2.1 if drift is noticeable.
- The `vibeytm://` URL scheme handler registration in Info.plist — Sprint 3 (when AppIntents need it).

## Next Steps After Sprint 0

1. Code review via `/code-review` on the Sprint 0 diff.
2. Commit + push.
3. Generate Sprint 1 PRP via `/prp-plan` from the design doc.
4. Run Sprint 1 (core-loop parity: ArtistView, ContextMenu, AddToPlaylistPicker, global shortcuts, cheatsheet).
