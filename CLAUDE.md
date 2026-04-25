# VibeYTM

Apple Music-style YouTube Music desktop app.

## Tech Stack
- Tauri 2.x (Rust backend, WKWebView frontend)
- React 19 + TypeScript (custom UI)
- Vite (build tool)

## Commands
- `pnpm install` — install dependencies
- `pnpm tauri dev` — run in development mode
- `pnpm tauri build` — production build
- `pnpm typecheck` — TypeScript type check
- `cargo check` — Rust type check (run from src-tauri/)
- `cargo test` — Rust tests (run from src-tauri/)

## Dev Workflow
- After every code change that requires a restart to take effect (any Rust source under `src-tauri/`, anything under `scripts/inject/` injected into the YTM webview, `tauri.conf.json`, or `Cargo.toml`), automatically restart `pnpm tauri dev` without waiting for the user to ask. Standard pattern: `pkill -f "tauri dev" 2>/dev/null; pkill -f "VibeYTM" 2>/dev/null; sleep 1; pnpm tauri dev` (run in background).
- Frontend-only changes (`src/**/*.{ts,tsx,css}`) are picked up by Vite HMR — do NOT restart for those unless module-level state needs to be reset (e.g. changes to a module exporting mutable singletons).
- After restarting, verify the build came up cleanly via the task output before reporting work as done.

## Architecture
- Two WebView model: visible React UI + hidden YouTube Music audio engine
- Event-driven: tokio broadcast bus connects all components
- Plugin-based integrations: each implements `Integration` trait
- PlayerState (Rust) is the single source of truth

## Versioning
- Bump the patch version (last number) in both `package.json` and `src-tauri/tauri.conf.json` with every commit that includes code changes
- Do NOT bump for docs-only commits (e.g. changes to .md files only)
- Example: 0.5.0 → 0.5.1 → 0.5.2 → ... → 0.5.10 → 0.5.11

## Release Process
- When creating a new GitHub release, always build the DMG first with `pnpm tauri build`
- Attach the DMG (`src-tauri/target/release/bundle/dmg/VibeYTM_*.dmg`) to the release
- Always include the macOS Gatekeeper notice at the top of release notes (the app is unsigned, so users must run `xattr -cr /Applications/VibeYTM.app` after installing)

## Screenshots
- Screenshots are taken via `screencapture -l <windowID>` (use Swift/CoreGraphics to find the VibeYTM window ID)
- The user's profile picture and name are in the sidebar bottom-left at approximately x:65-265, y:1543-1618 (at 2536x1736 resolution)
- Always blur (never solid-cover) the profile area: crop the region, apply heavy Gaussian blur in isolation, paste back
- The blur must not cross into the rounded window corners or desktop area — blur the cropped region independently to prevent color bleed

## Key Patterns
- IPC: Frontend calls Rust via `invoke()`, Rust emits events via `app.emit()`
- State: `Arc<RwLock<PlayerState>>` managed by Tauri
- Integrations: subscribe to event bus, react independently
- Types: Rust structs mirror TypeScript interfaces (camelCase serde)
