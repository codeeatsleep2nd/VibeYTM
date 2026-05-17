# VibeYTM 2.0

Native macOS YouTube Music desktop app. SwiftUI 6.2 on macOS 26 (Tahoe).

For the v1.x Tauri build (archived in `v1/`), see `v1/CLAUDE.md` —
those WKWebView visible-UI quirks no longer apply to v2.0.

## Tech Stack

- **SwiftUI 6.2** on **macOS 26** with Liquid Glass chrome
- **Swift 6 strict concurrency** — `@Observable`, `@MainActor`, `Sendable` enforced
- **Swift Package Manager** — `app/VibeYTMApp/Package.swift` is the app target;
  Xcode 26 opens it natively
- **Foundation Models** (on-device) — `SystemLanguageModel` + `@Generable` schemas
- **AppIntents + WidgetKit + ActivityKit** — Spotlight / Siri / widgets / Control Center
- **Hidden WKWebView audio engine** — preserves YTM Premium / DRM / catalog
  (same architecture as v1.x — see "Audio engine" below)

## Commands

```bash
# Pure SPM iteration (no .app bundle, no Xcode required)
cd app/VibeYTMApp && swift run VibeYTMApp

# Build a real .app bundle + install to ~/Applications
bash app/build.sh --install

# Open as Xcode project (when Xcode 26 is installed)
xed app/VibeYTMApp/Package.swift

# Per-package build/test
cd app/Packages/PlayerCore && swift build && swift test
cd app/Packages/YTMBridge && swift build && swift test
cd app/Packages/VibeYTMIntents && swift build
cd app/VibeYTMApp && swift build
```

## Dev Workflow

- **Frontend-only changes** (any view file): rebuild via `swift run`/`build.sh`,
  or just hit Cmd+R in Xcode. No app restart needed beyond the build cycle.
- **AppBootstrap or BridgeHost changes**: full app relaunch required (these
  hold module-level state).
- **Logger subsystem is `com.vibeytm.dev`** (matches bundle ID, preserved
  from v1.x for `WKWebsiteDataStore` cookie continuity). Filter
  Console.app by `subsystem:com.vibeytm.dev` to see only VibeYTM logs.

## Verification Discipline

- NEVER ask the user to debug, test, or verify a fix unless the action
  genuinely cannot be performed without human input (interactive system
  dialogs, audio judgment, visual aesthetics).
- For everything else, verify the fix yourself:
  - Run the full validation suite: `swift build` + `swift test` per package.
  - Visually verify via `bash app/build.sh --install && open ~/Applications/VibeYTM.app`.
  - Console.app filter `subsystem:com.vibeytm.dev` for runtime logs.
- Before touching any file in `app/Packages/YTMBridge/`, read
  `app/SWIFTUI_CHECKLIST.md` end-to-end. The bridge has documented
  invariants from real defects fixed over many cycles.
- After each round of fixes, walk every relevant `SWIFTUI_CHECKLIST.md`
  item against the current code and confirm in the response that each
  invariant still holds — line numbers cited.

## Architecture

```
RootView (sidebar + detail + chrome)
   │
   ├─ AppRouter (@Observable @MainActor)
   │   navigation + sheet/overlay state; handle(deepLink:) parser
   │
   ├─ AppBootstrap (@MainActor @Observable, app-lifetime singleton)
   │   ├─ PlayerStore (current PlayerState)
   │   ├─ BridgeHost (hidden WKWebView, YTM audio engine)
   │   ├─ BridgeReducer (pure: SeekFilter → VolumeSettle → TrackChangeGuard)
   │   ├─ PersistenceStore (throttled session save)
   │   ├─ NowPlayingIntegration (MPNowPlayingInfoCenter + MPRemoteCommandCenter)
   │   ├─ SharedPlaybackSnapshotWriter (App Group container — for widgets)
   │   └─ TrackChangeNotifier (UN notifications on background track change)
   │
   ├─ VibeYTMIntents package
   │   AppEntity (TrackEntity) + AppIntent (PlayPauseIntent etc.)
   │   + PlaybackIntentRegistry actor
   │
   └─ DJCopilot package (Xcode 26 required for FoundationModelsMacros)
       @Generable QueuePlan + DJCopilotSession
```

## Audio Engine — same WKWebView pattern as v1.x

Hidden `WKWebView` pointed at `music.youtube.com`. Polls
`window.__VIBEYTM_STATE__` every 150 ms. Same IPC pattern as v1.x but
implemented in Swift (`app/Packages/YTMBridge/Sources/YTMBridge/BridgeHost.swift`).

The three nastiest quirks are ported as pure-logic Swift modules with
Swift Testing suites:
- `SeekFilter.swift` — drops POSITION_UPDATED echoes > 2s from seek target
  until target reached or 5s elapsed
- `VolumeSettle.swift` — trusts storedVolume over reportedVolume during 2s
  push window after `set_volume` IPC; emits only when effective volume changes
- `TrackChangeGuard.swift` — only arms when videoId actually changed (not
  on metadata refinement)

These have parity with the JS originals in `v1/scripts/inject/ytm-player-bridge.js`.
**Touching them re-opens the original bugs.** Test changes via
`cd app/Packages/YTMBridge && swift test`.

## SwiftUI conventions

- **`@Observable` + `@Environment(T.self)`** — not `@StateObject` /
  `@ObservedObject`. AppRouter and PlayerStore are the canonical examples.
- **`@Bindable var x = x`** at the top of `body` when you need to pass
  `$x.property` bindings into sheet presenters (e.g. PlayerChrome passes
  `$router.isQueueOpen` into `.sheet(isPresented:)`).
- **NowPlayingExpanded dismissal**: 5-path closure-based contract (see file
  header). NEVER switch to `@Environment(\.dismiss)` — it has historically
  failed silently inside sheets with focus modifiers.
- **DesignTokens** at `app/Packages/PlayerCore/Sources/PlayerCore/DesignTokens.swift`
  mirrors `docs/design/dongli-SwiftUI-design.md` Sprint 0 D8 spec. Match
  DESIGN.md OKLCH values for new colors.
- **Logger**: `Logger(subsystem: "com.vibeytm.dev", category: "<Package>")`.
  Reserved categories: `Bridge`, `Player`, `Router`, `Snapshot`, `Copilot`,
  `Widget`, `Intent`, `Persistence`, `Notifier`.
- **Dev-launch hack** (`NSApp.setActivationPolicy(.regular)` etc.) is gated
  behind `#if DEBUG && SPM_DEV_HARNESS`. Only fires under `swift run`;
  Xcode-built builds skip it because the Xcode project doesn't define the flag.

## File Layout

```
app/
├── Packages/
│   ├── PlayerCore/          Value-type state + DesignTokens
│   ├── YTMBridge/           Audio engine + bridge filters
│   ├── VibeYTMIntents/      AppEntity + AppIntent + AppShortcuts
│   └── DJCopilot/           Foundation Models (Xcode 26 required)
├── VibeYTMApp/
│   ├── Sources/VibeYTMApp/  All views + AppBootstrap
│   ├── Tests/               Swift Testing suites
│   └── Package.swift        SPM target
├── VibeYTM.entitlements     Canonical entitlements (App Group, JIT, etc.)
├── build.sh                 SPM → .app bundle assembly
├── README.md                Swift port status
└── SWIFTUI_CHECKLIST.md     Bridge-side regression invariants

docs/design/                 gstack-generated design + planning trail
v1/                          Archived Tauri v1.x build
.claude/PRPs/                Sprint PRPs + reports
```

## Versioning

- **Bump the patch version** in `app/build.sh` (`CFBundleShortVersionString`) with
  every commit that includes code changes.
- Do NOT bump for docs-only commits.

## Release Process

- `bash app/build.sh --install` builds + signs + installs locally.
- For a release `.dmg`, `xcodebuild -archive` (Xcode 26 required) then
  `hdiutil create`; attach to GitHub Releases.
- Ship ad-hoc signed until paid Apple Developer Program; README v2.0 keeps
  the `xattr -cr` Gatekeeper instructions.

## Conflict Detection — ASK BEFORE DECIDING

Before implementing ANY new feature ask or bug-fix ask, scan whether it
conflicts with an existing invariant. Examples that count as conflicts:

- The new ask reverses or weakens a rule in this file or `app/SWIFTUI_CHECKLIST.md`
- The new ask changes the source of truth for state another component reads
  (e.g. switching navigation away from AppRouter to local `@State`)
- The new ask is the inverse of a fix shipped earlier in the same session
- The new ask requires touching `BridgeHost.swift`, `SeekFilter.swift`,
  `VolumeSettle.swift`, or `TrackChangeGuard.swift` without re-reading
  the SWIFTUI_CHECKLIST.md invariants for those modules

When a conflict is detected, **STOP and ask the user** — phrase the
conflict explicitly ("X would undo Y from commit Z; want to proceed,
refine the new ask, or revert Y?") and wait for their decision.

## Visual fidelity to Apple Music / Liquid Glass — VERIFY before designing

When the ask is "make UI match X" (Apple Music, iOS 26 Now Playing, etc.),
do NOT design from memory:

1. Pull a real reference — Chrome DevTools MCP `take_screenshot` of
   `music.apple.com` or the actual app side-by-side. Save to `/tmp/`.
2. Inventory what you see — name every visible element, its position,
   shape, color, approximate size.
3. Don't invent SF-Symbol glyphs from Unicode. Use real SF Symbol names
   (`sparkles`, `play.fill`, etc.) verified against Apple's catalog.
4. Show the user a mockup before writing code. ASCII mockup or annotated
   screenshot. Wrong mockup = 30s correction; wrong implementation = revert.

If you skipped any of the above and the user pushes back with "that's not
what X looks like", stop iterating on memory — go fetch a real screenshot
before the next attempt.

## Reading more

- `app/SWIFTUI_CHECKLIST.md` — bridge-side regression invariants
- `app/README.md` — Swift port status notes
- `docs/design/dongli-SwiftUI-design.md` — full design + decision trail
- `docs/design/sprint-0-spine.plan.md` — Sprint 0 implementation PRP
- `v1/CLAUDE.md` — archived Tauri-era conventions (don't apply to v2.0
  visible UI but the bridge-side quirks documented there still inform
  YTMBridge.swift)
