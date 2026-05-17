<p align="center">
  <img src="docs/screenshot-home.png" alt="VibeYTM" width="800">
</p>

<p align="center">
  <a href="https://github.com/codeeatsleep2nd/VibeYTM/releases/latest"><img src="https://img.shields.io/github/v/release/codeeatsleep2nd/VibeYTM?style=flat-square&color=red" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2026-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/swift-6.2-orange?style=flat-square" alt="Swift 6.2">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/codeeatsleep2nd/VibeYTM?style=flat-square&color=green" alt="License"></a>
</p>

# VibeYTM 2.0

A native macOS YouTube Music desktop app built with **SwiftUI 6.2** on
**macOS 26 (Tahoe)**. Full Liquid Glass treatment, real Apple-grade chrome,
on-device AI playlist generation, native AppIntents / Spotlight / Siri
integration — none of the WKWebView quirks of the v1.x Tauri build.

## What's new in v2.0

- **Native SwiftUI** with macOS 26 Liquid Glass chrome everywhere — sidebar,
  player capsule, sheets, overlays.
- **Foundation Models DJ Copilot** (the "Vibe" feature) — type *"darker
  vibe, no live versions, 25 minutes"* and the on-device LLM streams a
  matching queue into your player.
- **AppIntents + Spotlight + Siri** — *"Hey Siri, play in VibeYTM"*,
  ⌘Space → "Skip in VibeYTM", build custom workflows in Shortcuts.app.
- **Now Playing widget** + **Control Center music tile** with interactive
  Play / Pause / Next buttons.
- **AppRouter-driven navigation** — deep-links like `vibeytm://album/MPRE_xyz`
  open the right surface whether the app is running or not.
- **Real macOS menu bar** with standard items: View → Show Now Playing /
  Show Lyrics / Show Queue, ⌘/ for keyboard cheatsheet, ⌘L to like the
  current track.
- **Cover art in the OS Now Playing widget** via a Swift 6 Sendable-clean
  pipeline.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| UI | **SwiftUI 6.2** with Liquid Glass |
| Concurrency | Swift 6 strict isolation, `@Observable`, `@MainActor` |
| Audio engine | Hidden `WKWebView` pointed at music.youtube.com (preserves YTM Premium / DRM / catalog) |
| Bridge | `BridgeHost.swift` — `evaluateJavaScript` IPC, 150 ms poll, pure-logic quirk filters |
| AI | **Foundation Models** on-device (`SystemLanguageModel.default` + `@Generable` schemas + Tool calling) |
| AppIntents | First-class — `AppEntity` over Track, `AudioPlaybackIntent` for transport |
| Widgets | WidgetKit + Control Center via App Group cross-process snapshot |
| Build | Swift Package Manager (Xcode 26 / `swift build`) |
| Min OS | **macOS 26 (Tahoe)** |
| Bundle Size | ~4 MB |

## Installation

### Download

Download the latest `.dmg` from the [Releases page](https://github.com/codeeatsleep2nd/VibeYTM/releases/latest).

> **macOS Gatekeeper:** VibeYTM 2.0 ships ad-hoc signed (no paid Apple
> Developer ID yet). On first install, run:
> ```
> xattr -cr /Applications/VibeYTM.app
> ```
> Then double-click to launch.

### Build from Source

Prerequisites:
- **macOS 26 (Tahoe)** — runtime floor
- **Xcode 26** OR Swift 6.2 command-line toolchain
- An Apple ID (free) signed into Xcode — provides a personal team for dev signing

```bash
git clone https://github.com/codeeatsleep2nd/VibeYTM.git
cd VibeYTM
bash app/build.sh --install
```

The build script builds via SPM, assembles a `.app` bundle with the right
Info.plist + entitlements, ad-hoc signs via `codesign --sign -`, and copies
to `~/Applications/VibeYTM.app`.

For Xcode-based iteration:
```bash
xed app/VibeYTMApp/Package.swift  # opens Package as Xcode project
```

For pure SPM iteration (no .app bundle, no Xcode):
```bash
cd app/VibeYTMApp
swift run VibeYTMApp
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  VibeYTM 2.0 (native macOS .app)                                    │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  SwiftUI views — RootView, SidebarView, PlayerChrome,       │    │
│  │  NowPlayingExpanded, LyricsPanel, QueuePanel, BrowseDetail, │    │
│  │  Home/Search/Library/Explore/Settings, FocusTimerView       │    │
│  └─────────────────────────────┬───────────────────────────────┘    │
│  ┌─────────────────────────────▼───────────────────────────────┐    │
│  │  AppRouter — single source of truth for navigation +        │    │
│  │  sheet/overlay state. Deep-link handler for vibeytm://      │    │
│  └─────────────────────────────┬───────────────────────────────┘    │
│  ┌─────────────────────────────▼───────────────────────────────┐    │
│  │  AppBootstrap (@MainActor @Observable)                      │    │
│  │  Owns: PlayerStore | BridgeHost | PersistenceStore |        │    │
│  │  NowPlayingIntegration | SharedPlaybackSnapshotWriter |     │    │
│  │  TrackChangeNotifier                                        │    │
│  └─────────────────────────────┬───────────────────────────────┘    │
│  ┌──────────────────┬──────────┴────────────┬───────────────────┐   │
│  ▼                  ▼                       ▼                   ▼   │
│  PlayerCore   YTMBridge.swift         VibeYTMIntents      DJCopilot  │
│  (value-type  (hidden WKWebView       (AppEntity +        (Found.    │
│  state model, audio engine,           AppIntent +         Models     │
│  DesignTokens) pure-logic filters)    AppShortcuts)       @Generable)│
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ App Group: group.com.vibeytm.dev
                          (SharedPlaybackSnapshot.json)
                                  │
                                  ▼ Darwin notification
                          ┌───────┴───────┐
                          ▼               ▼
                   Now Playing       Control Center
                   widget            music tile
```

## Project Layout

```
/
├── README.md             This file
├── CLAUDE.md             AI-assistance conventions (SwiftUI v2.0 patterns)
├── LICENSE
├── app/                  SwiftUI v2.0 source
│   ├── Packages/
│   │   ├── PlayerCore/      Value-type state model + DesignTokens
│   │   ├── YTMBridge/       Hidden WKWebView audio engine + bridge
│   │   ├── VibeYTMIntents/  AppEntity + AppIntent + AppShortcuts
│   │   └── DJCopilot/       Foundation Models DJ copilot (Xcode 26 req.)
│   ├── VibeYTMApp/          Main app target (SwiftUI views, AppBootstrap)
│   ├── VibeYTM.entitlements Canonical entitlements file
│   ├── build.sh             Build .app bundle without Xcode
│   ├── README.md            Swift port status + dev notes
│   └── SWIFTUI_CHECKLIST.md Bridge-side regression invariants
├── docs/                 Screenshots + design docs
│   └── design/              Design doc + test plan + Sprint 0 PRP
├── v1/                   Archived Tauri v1.x build (see v1/README.md)
└── .claude/              PRP plans + reports
```

## Roadmap (v2.x+)

- **v2.1+** — Apple Developer ID + notarization (kills the `xattr -cr` dance);
  Sparkle in-app updater; App Group container actually provisioned (widgets
  start showing real-time snapshot data).
- **v2.2+** — Custom about window; richer Spotlight donation with library
  scanning; iPhone companion app for Live Activities.
- **v3.x** — Possible AVPlayer migration (loses Premium/DRM but eliminates
  the hidden WebView entirely). Currently rejected — see
  `docs/design/sprint-0-spine.plan.md` Premise 3 for the reasoning.

## Origin story

VibeYTM started as v1.x — a Tauri 2.x + React 19 + Rust desktop app. That
build worked but accumulated ~30 WKWebView visible-UI quirks (click target
swallowing, pointer-events overlay traps, transform-breaks-hit-testing,
seek echo races) documented in `v1/CLAUDE.md`. v2.0 is the rewrite in
native SwiftUI — same hidden-WKWebView audio engine, but every visible
surface is real native chrome. The v1.x code stays in `v1/` for reference.

See [`v1/README.md`](v1/README.md) for the archived Tauri build and how to run it.

## Design docs

`docs/design/` contains the full planning rigor that produced v2.0:

- `dongli-SwiftUI-design.md` — the design doc from `/office-hours` + 3 review passes
- `dongli-SwiftUI-eng-review-test-plan.md` — test coverage plan from `/plan-eng-review`
- `sprint-0-spine.plan.md` — the implementation PRP from `/prp-plan`
- `sprint-0-spine-report.md` — implementation report from `/prp-implement`

These were produced by gstack skills (`/office-hours` → `/plan-eng-review` →
`/plan-design-review` → `/prp-plan` → `/prp-implement`). Keeping them in the
repo means the decision trail stays grep-able for future contributors.
