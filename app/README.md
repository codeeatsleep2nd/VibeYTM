# VibeYTM — Swift app

Greenfield SwiftUI rewrite of VibeYTM. Replaces the Tauri 2.x + React + Rust
stack on `main`. Ships as a native macOS 26 application with built-in
Liquid Glass chrome.

## Status

Scaffolding stage. On disk so far:

- `Packages/YTMBridge` — pure-logic ports of three WKWebView quirks:
  `SeekFilter`, `VolumeSettle`, `TrackChangeGuard`. Each has a CLT-runnable
  validator and a Swift Testing suite for Xcode 26.
- `Packages/PlayerCore` — value-type port of `src-tauri/src/state/player.rs`
  with Codable/camelCase round-trips proven.
- `VibeYTMApp` — minimal SwiftUI scaffolding (`NavigationSplitView` with a
  placeholder sidebar). Builds and launches under `swift run` on macOS 26.
  Renders the Liquid Glass sidebar treatment that ships free with macOS 26
  `NavigationSplitView` — no explicit `.glassEffect()` needed at this layer.
- `BridgeHost` — `@MainActor` host wrapping a hidden `WKWebView` that loads
  `music.youtube.com` with the existing JS bridge payload
  (`InjectedScripts/ytm-player-bridge.js`) injected at document start.
  Polls `window.__VIBEYTM_STATE__` and `window.__VIBEYTM_LOGGED_IN__`
  every 150 ms (matching the Rust poller's cadence), decodes the JSON
  envelope into a `BridgeState` value, and fans it out via a closure.
- `BridgeState` — Codable mirror of `window.__VIBEYTM_STATE__`. Decoder
  is partial-payload tolerant (every field has a default) so transitional
  states during YTM page navigation don't fail the cycle.
- `BridgeReducer` — pure pipeline. Takes (prev `PlayerState`, prev
  `BridgePipelineState`, fresh `BridgeState`, last user-pushed volume,
  current time) and returns next state + next pipeline. Composes
  `TrackChangeGuard` → `SeekFilter` → `VolumeSettle` in order so every
  WKWebView quirk caught by those modules is enforced before SwiftUI
  sees the result. 9 reducer-level cases passing.
- `PlayerStore` — `@Observable @MainActor` wrapper around `PlayerState`.
  Pure data carrier (`apply(_:)` is the only entry point); no reducer
  composition — that lives in `AppBootstrap` so PlayerCore stays
  decoupled from YTMBridge.
- `AppBootstrap` — the wiring layer. Owns the bridge host, pipeline
  state, and last-pushed volume; runs the reducer per snapshot and
  writes the result through `PlayerStore`.
- `AuthWebView` — visible WKWebView shown inline when `state.loggedIn`
  is `false`. Shares `WKWebsiteDataStore.default()` with the hidden
  audio engine, so a successful sign-in here authenticates both views;
  the next bridge poll cycle flips `loggedIn` to `true` and `RootView`
  switches to the main UI automatically.
- `RootView` — three-way branch on `state.loggedIn`:
  - `nil` → `BootScaffold` (small "Booting bridge…" placeholder)
  - `false` → `AuthScaffold` (the inline AuthWebView)
  - `true` → `SignedInRoot` (NavigationSplitView placeholder + a real
    live now-playing strip showing track title, artist, position).
- IPC entry points on `BridgeHost` — `play()`, `pause()`, `togglePlay()`,
  `next()`, `previous()`, `seek(secs:)`, `setVolume(level:)`,
  `toggleShuffle()`, `toggleRepeatMode()`, `toggleLike()`. Forwarded by
  `AppBootstrap.{play, pause, …}` which also maintain pipeline-state
  invariants (arming the SeekFilter on seek, the VolumeSettle window on
  setVolume) so the WKWebView quirks the filter modules guard against
  stay closed even when the user drives playback from SwiftUI.
- `NowPlayingIntegration` — surfaces current track to
  `MPNowPlayingInfoCenter` (title, artist, album, duration, elapsed,
  artwork) and wires `MPRemoteCommandCenter` so OS-level media keys
  (F8/F7/F9), Bluetooth headphone buttons, the macOS Now Playing widget,
  and Control Center all drive `AppBootstrap`. Async artwork fetch via
  `URLSession.shared` with a one-entry URL cache.
- `PlayerChrome` — floating bottom Liquid Glass capsule
  (`.glassEffect(in: .capsule)`) with: artwork thumb, title/artist,
  scrubbable position slider with current/total time, prev / play-pause
  / next transport buttons, shuffle / repeat / like toggles, and a
  volume slider with speaker icons. Position scrubber tracks live
  `positionSecs` while idle, holds the dragged value during user
  interaction, then commits via `bootstrap.seek(secs:)` on release —
  which arms the SeekFilter so the burst of stale POSITION_UPDATED
  echoes that follows the seek gets dropped automatically.
- `SidebarView` — Apple Music-style section layout (Search / Browse with
  Home + Explore / Library with Recently Played + Artists + Albums +
  Songs / Playlists with All Playlists) plus a bottom-pinned profile row
  showing the avatar + name once the bridge has reported an `Account`.
- The end-to-end loop runs: launch the app, the hidden WKWebView loads
  YTM, the inject script populates the state globals, `BridgeHost`
  polls them, `BridgeReducer` produces a typed `PlayerState`, `PlayerStore`
  publishes it, `NowPlayingIntegration` surfaces it to the OS, and
  SwiftUI re-renders the chrome. User input on the chrome (transport,
  scrubbing, volume) flows back through `AppBootstrap` →
  `BridgeHost.command(_:args:)` → `__VIBEYTM_COMMAND__` in the YTM
  page. Verified visually:
  - `/tmp/vibeytm-auth-flow.png` — inline AuthWebView when signed out.
  - `/tmp/vibeytm-final.png` — full sidebar + chrome when signed in.

Still pending: persistence (last track, volume, sidebar selection), an
Innertube/YTMData client to populate Browse / Library / Playlists with
real data, lyrics panel, queue panel, NowPlaying expanded overlay, and
`ImageCache`. The reference screenshots at
`/tmp/vibeytm-apple-music-ref{,-2}.png` stay relevant for those passes.

## Prerequisites

- macOS 26 (Tahoe) — runtime floor; the app uses Liquid Glass APIs that do
  not exist on macOS 15 or below.
- Xcode 26 + Command Line Tools — required to build the app target and to
  run `swift test` (Swift Testing depends on `_Testing_Foundation.framework`,
  which ships incomplete in CLT-only installs of Swift 6.2 — see "Known
  toolchain quirks" below).

Confirm with:

```bash
sw_vers -productVersion          # 26.x.x
xcodebuild -version              # Xcode 26.x
swift --version                  # Apple Swift version 6.2 or later
xcrun --show-sdk-version         # 26.0
```

## Layout

```
app/
├── README.md                          # this file
├── VibeYTM.xcodeproj/                 # NOT YET — lands with the app target
├── VibeYTM/                           # NOT YET — main app target (UI + entitlements)
├── VibeYTMApp/                        # SwiftUI app (SPM-only until Xcode 26 lands a project)
│   ├── Package.swift
│   └── Sources/VibeYTMApp/
│       ├── VibeYTMApp.swift           # @main App + AppBootstrap (pipeline + IPC forwarders)
│       ├── RootView.swift             # tri-state branch on loggedIn
│       ├── SidebarView.swift          # Apple-Music-style sections + profile row
│       ├── PlayerChrome.swift         # bottom Liquid Glass capsule + scrubber
│       ├── AuthWebView.swift          # NSViewRepresentable WKWebView for sign-in
│       └── NowPlayingIntegration.swift # MPNowPlayingInfoCenter + MPRemoteCommandCenter
└── Packages/
    ├── YTMBridge/                     # hidden WKWebView + JS bridge logic
    │   ├── Package.swift
    │   ├── Sources/
    │   │   ├── YTMBridge/
    │   │   │   ├── SeekFilter.swift          # POSITION_UPDATED echo filter (pure)
    │   │   │   ├── VolumeSettle.swift        # post-push volume reconcile (issue #76)
    │   │   │   ├── TrackChangeGuard.swift    # isSameTrack guard + stale-position filter
    │   │   │   ├── BridgeState.swift         # Codable mirror of __VIBEYTM_STATE__
    │   │   │   ├── BridgeReducer.swift       # pure BridgeState→PlayerState pipeline
    │   │   │   ├── BridgeHost.swift          # @MainActor WKWebView host + poller
    │   │   │   └── InjectedScripts/          # SPM resource bundle
    │   │   ├── SeekFilterValidator/main.swift           # CLT proxy
    │   │   ├── VolumeSettleValidator/main.swift         # CLT proxy
    │   │   ├── TrackChangeGuardValidator/main.swift     # CLT proxy
    │   │   └── BridgeReducerValidator/main.swift        # CLT proxy
    │   └── Tests/YTMBridgeTests/
    │       ├── SeekFilterTests.swift         # Swift Testing — needs Xcode 26
    │       ├── VolumeSettleTests.swift       # Swift Testing — needs Xcode 26
    │       ├── TrackChangeGuardTests.swift   # Swift Testing — needs Xcode 26
    │       └── BridgeReducerTests.swift      # Swift Testing — needs Xcode 26
    └── PlayerCore/                    # PlayerState, Track, Queue value types
        ├── Package.swift
        ├── Sources/
        │   ├── PlayerCore/
        │   │   ├── PlaybackStatus.swift
        │   │   ├── RepeatMode.swift
        │   │   ├── Account.swift
        │   │   ├── Track.swift
        │   │   ├── PendingRestore.swift
        │   │   └── PlayerState.swift
        │   └── PlayerCoreValidator/main.swift   # CLT proxy
        └── Tests/PlayerCoreTests/
            └── PlayerStateTests.swift           # Swift Testing — needs Xcode 26
```

## Commands

### Run the validators (CLT-friendly)

Each ported pure-logic module has a paired `*Validator` executable that
runs the same cases as its Swift Testing counterpart using inline
assertions. Use these until Xcode 26 is installed.

```bash
swift run --package-path app/Packages/YTMBridge  SeekFilterValidator
swift run --package-path app/Packages/YTMBridge  VolumeSettleValidator
swift run --package-path app/Packages/YTMBridge  TrackChangeGuardValidator
swift run --package-path app/Packages/YTMBridge  BridgeReducerValidator
swift run --package-path app/Packages/PlayerCore PlayerCoreValidator
```

Each ends with `All N cases passed.` and exit code 0 when green.

### Launch the SwiftUI scaffold

```bash
swift run --package-path app/VibeYTMApp VibeYTMApp
```

Opens a 1024×640 minimum-sized window with a NavigationSplitView. The
sidebar gets Liquid Glass treatment for free on macOS 26 — no explicit
`.glassEffect()` calls in the source. Press ⌘W to close.

### Run the proper test suites (requires Xcode 26)

```bash
swift test --package-path app/Packages/YTMBridge  --enable-swift-testing --disable-xctest
swift test --package-path app/Packages/PlayerCore --enable-swift-testing --disable-xctest
```

Once Xcode 26 is installed and selected via `xcode-select -s
/Applications/Xcode.app`, these commands run the Swift Testing suites
directly. The `*Validator` targets become redundant and can be removed.

### Build the app (NOT YET — Xcode project lands later)

```bash
xcodebuild -project app/VibeYTM.xcodeproj -scheme VibeYTM build
```

## Known toolchain quirks

### `import Testing` fails under Command Line Tools 6.2

Apple's CLT 6.2 ships `Testing.framework` and `_Testing_Foundation.framework`
under `/Library/Developer/CommandLineTools/Library/Developer/Frameworks/`,
but the latter contains only the dynamic library — no `swiftmodule` or
`swiftinterface` is shipped. Result: `import Testing` resolves the top-level
`Testing` module, then fails to resolve its transitive `_Testing_Foundation`
import.

Workaround on this branch:

1. `Package.swift` adds `-F` to the `YTMBridgeTests` target's swift/linker
   settings so `Testing.framework` is found at all (without `-F`, SPM only
   passes `-I` and frameworks are invisible).
2. `SeekFilterValidator` runs the same cases without depending on the
   Testing framework, so we have a working proof of life under CLT.

Once Xcode 26 is installed, both the `-F` workaround and the validator
target become redundant. Delete them at that point — leaving them in place
is harmless but adds noise.

### macOS 26 deployment requires `swift-tools-version: 6.2`

`.macOS(.v26)` was introduced in `PackageDescription` 6.2. The
`swift-tools-version` line at the top of `Package.swift` must be `6.2` or
the manifest fails to compile.

## Why this layout

- **One Xcode project + many local SPM packages.** Logic lives in packages
  (`YTMBridge`, `PlayerCore`, `YTMData`, `Integrations`, `ImageCache`); the
  app target is UI-only. Lets us unit-test pure logic with `swift test`
  headlessly — no app launch, no UI test flake.
- **Pure WKWebView quirks live in dedicated test targets.** `SeekFilter`,
  the volume push-settle window, the track-change debounce, and the
  `localStorage` seed-then-persist sequence are each ported as pure
  functions on the Swift side, with the test cases that pinned them on the
  React side carried over verbatim. Anything that bit us before should
  catch us before merge.

## See also

- `../RESEARCH.md` — feasibility study and competitive landscape (Kaset,
  Pear Desktop, etc.). Still accurate for this rewrite.
- `../CLAUDE.md` — project-wide invariants and WKWebView quirks. Currently
  describes the React/Tauri tree; will be rewritten for the Swift
  architecture as part of the merge.
- `../TEST_CHECKLIST.md` — parity bar for the merge to `main`.
