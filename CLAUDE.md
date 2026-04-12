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

## Architecture
- Two WebView model: visible React UI + hidden YouTube Music audio engine
- Event-driven: tokio broadcast bus connects all components
- Plugin-based integrations: each implements `Integration` trait
- PlayerState (Rust) is the single source of truth

## Key Patterns
- IPC: Frontend calls Rust via `invoke()`, Rust emits events via `app.emit()`
- State: `Arc<RwLock<PlayerState>>` managed by Tauri
- Integrations: subscribe to event bus, react independently
- Types: Rust structs mirror TypeScript interfaces (camelCase serde)
