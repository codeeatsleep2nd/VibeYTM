<p align="center">
  <img src="docs/screenshot-home.png" alt="VibeYTM" width="800">
</p>

<p align="center">
  <a href="https://github.com/codeeatsleep2nd/VibeYTM/releases/latest"><img src="https://img.shields.io/github/v/release/codeeatsleep2nd/VibeYTM?style=flat-square&color=red" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/codeeatsleep2nd/VibeYTM?style=flat-square&color=green" alt="License"></a>
</p>

# VibeYTM

A YouTube Music desktop app built with Tauri, React, and Rust.

## Features

- Custom UI with sidebar navigation, album grids, and player bar
- Apple Music-style player chrome with foldable sidebar
- Background playback — music continues when the window is closed
- System tray with playback controls
- Media key support (Play/Pause, Next, Previous)
- Now Playing Control Center integration (macOS)
- Desktop notifications on track change
- Global keyboard shortcuts (configurable)
- Playing queue with drag-to-reorder and album artwork
- Synced lyrics with karaoke-style highlighting (YTM timed lyrics → LRCLIB → NetEase fallback)
- Lyrics pre-fetch for current and next tracks in queue
- Audio counterpart detection — always shows album art, never video thumbnails
- Session persistence — resumes last track and position on restart
- Search history — last 5 queries as quick-tap chips
- Blur-and-spinner reload UX
- Disk-cache stats in Settings with one-click clear
- Custom About window with version info

## Screenshots

<p align="center">
  <img src="docs/screenshot-home.png" alt="Home Page" width="800">
</p>

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Tauri 2.x |
| Backend | Rust |
| Frontend | React 19 + TypeScript |
| Build | Vite |
| Audio Engine | YouTube Music (hidden WebView) |
| Bundle Size | ~4 MB |

## Installation

### Download

Download the latest `.dmg` from the [Releases page](https://github.com/codeeatsleep2nd/VibeYTM/releases/latest).

> **macOS Gatekeeper:** After installing, run `xattr -cr /Applications/VibeYTM.app` in Terminal if macOS says the app is damaged.

### Build from Source

Prerequisites:
- Rust (rustup)
- Node.js 20+
- pnpm

```bash
git clone https://github.com/codeeatsleep2nd/VibeYTM.git
cd VibeYTM
pnpm install
pnpm tauri build
```

The built app will be at `src-tauri/target/release/bundle/macos/VibeYTM.app`.

## Development

```bash
pnpm install
pnpm tauri dev
```

## Architecture

VibeYTM uses a two-WebView architecture:

1. **Visible WebView** — Custom React UI
2. **Hidden WebView** — YouTube Music web player (audio engine only)

The Rust backend acts as the bridge:
- Event bus (tokio broadcast) connects all components
- Plugin-based integrations (each implements an `Integration` trait)
- PlayerState is the single source of truth

See [DESIGN.md](DESIGN.md) for the full system design.

## Project Structure

```
vibeytm/
├── src/                    # React frontend
│   ├── components/         # UI components (layout, player, browse, pages)
│   ├── hooks/              # React hooks (player state, lyrics, login, seek filter)
│   ├── lib/                # Types, IPC wrappers, events, caches
│   └── styles/             # CSS tokens + global styles
├── src-tauri/              # Rust backend
│   └── src/
│       ├── commands/       # Tauri IPC commands
│       ├── events/         # Event bus
│       ├── integrations/   # Media controls, notifications, global shortcuts
│       ├── state/          # PlayerState, AppSettings
│       ├── tray/           # System tray
│       ├── ytm_api/        # YouTube Music API client
│       └── webview_bridge/ # Hidden WebView management
└── scripts/inject/         # JS bridge for YouTube Music player
```

## License

MIT

## Disclaimer

VibeYTM is an unofficial application and is not affiliated with YouTube or Google Inc. "YouTube", "YouTube Music" and the "YouTube Logo" are registered trademarks of Google Inc.
