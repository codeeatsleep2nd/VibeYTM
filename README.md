# VibeYTM

An Apple Music-style YouTube Music desktop app built with Tauri, React, and Rust.

## Features

- Apple Music-inspired UI with sidebar navigation, album grids, and player bar
- Background playback — music continues when the window is closed
- System tray with playback controls
- Media key support (Play/Pause, Next, Previous)
- Now Playing Control Center integration (macOS)
- Desktop notifications on track change
- Global keyboard shortcuts (configurable)
- Queue management with drag-to-reorder
- Synced lyrics display
- Custom CSS themes (coming soon)

## Screenshots

[screenshots will be added]

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

Download the latest `.dmg` from the Releases page.

### Build from Source

Prerequisites:
- Rust (rustup)
- Node.js 20+
- pnpm

```bash
git clone <repo-url>
cd vibeytm
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

1. **Visible WebView** — Custom React UI (Apple Music-style)
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
│   ├── hooks/              # React hooks (usePlayerState, useTauriEvent)
│   ├── lib/                # Types, IPC wrappers, events
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
