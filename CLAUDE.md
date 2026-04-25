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

## Verification Discipline
- NEVER ask the user to debug, test, or verify a fix unless the action genuinely cannot be performed without human input (e.g. interactive system dialogs, listening to audio, judging visual aesthetics).
- For everything else, verify the fix yourself before declaring it done:
  - Read the dev-server task output at `/private/tmp/claude-501/.../tasks/<task-id>.output` for runtime logs (track changes, /next calls, queue updates, errors).
  - Inspect dumped YTM API responses at `/tmp/vibeytm-resp-*.json` to confirm what the backend actually received and parsed.
  - Run the full validation suite: `pnpm typecheck`, `cd src-tauri && cargo check`, `cargo test --lib` (currently 78 tests).
  - Trace the previously-fixed code paths against the latest diff to confirm no regression of earlier bugs.
- When extra runtime visibility is needed, add a debug line via the bridge's `log()` ring (writes to `window.__VIBEYTM_DEBUG__`, surfaced by the Rust poller in dev-server output) — do NOT instruct the user to open WebView devtools and paste output.
- If something truly cannot be verified without the user (e.g. "does the lyric sync feel right by ear?"), say so explicitly: "I cannot verify X — please report what you observe" — instead of generically asking them to test.
- Before touching any file that has been the subject of repeated bug reports (especially `QueuePanel.tsx`, the bridge, and `playerApi`), re-read the full file and write down the invariants it depends on. Don't edit only the diff target.
- After each round of fixes, walk every previously-reported bug related to that area against the current code and confirm in the response that each prior fix is still in place — line numbers cited.

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

## WKWebView quirks (Tauri visible window)
The visible React UI runs in macOS WKWebView via Tauri. It does not behave identically to Chromium:

- **Click targets MUST be real `<button>` elements.** `<div role="button" tabIndex={0} onClick={...}>` looks a11y-equivalent and passes type-checking, but in this build the synthetic React `onClick` is silently dropped — mouse hover/enter/leave still fires, but the click never reaches React. This regresses every card on Home/Explore/Library/Search at once and is invisible until you actually try clicking. If you must avoid nested `<button>/<button>` HTML, change the INNER element to `<span role="button" onClick={...}>`, never the outer one. Verified 2026-04-24 via diagnostic IPC.
- **`pointer-events: none` on a stale-while-revalidate overlay kills clicks on cached children.** `ReloadOverlay` and similar wrappers must keep children interactive during refresh. Put `pointerEvents: 'none'` on a small corner spinner only, never on the wrapper around the still-visible content. The YTM bridge can stall ~30 s during audio-webview navigation; for that whole window every card becomes click-dead if the overlay blocks events.
- **`ReloadOverlay` MUST visually blur the children during refresh.** A 10 px `filter: blur(10px)` on the children layer is the user-facing "data is reloading" cue. CSS `filter` does NOT affect hit-testing — clicks still pass through to the underlying buttons — so the blur and the no-click-block rule above are independent. An earlier fix removed the blur and the click-block in the same sweep; only the click-block was the bug.
- **NEVER apply `transform` to the children-wrapping layer of `ReloadOverlay`.** `transform: scale(...)` creates a stacking context that this WKWebView build mishandles for hit-testing — clicks on some children stop registering. An attempt to use `scale(0.98)` to hide the blur halo broke clicks across Home / Explore / Library. The blur is enough on its own; transforms on the wrapper are forbidden. Locked in by the contract test in `src/components/LoadingOverlay.test.tsx`.
- **`pointer-events: auto` on a child OVERRIDES the parent's `none`.** If you put `pointer-events: none` on a closed-overlay container (e.g. `NowPlaying` when `isOpen=false`), but ANY descendant has explicit `pointer-events: auto` (e.g. the LRC column when `showLyrics=true`), that descendant remains click-active even though its parent is supposedly inert. Combined with `position: fixed`, this creates an invisible click-stealing region over whatever page is now in front. **Always AND child pointer-events with the parent's open state**: `pointerEvents: isOpen && childIsActive ? 'auto' : 'none'`. Also: when navigating away via the sidebar, reset every overlay flag (`setIsLyricsOpen(false)`, `setIsQueueOpen(false)`, `setIsNowPlayingOpen(false)`) — the sidebar nav handler in `src/App.tsx` does this; new overlays added in the future must too.
- **Background fetches need a settle delay after track change.** YTM's hidden audio webview navigates on every track change, which hangs `fetch()` calls inside it for ~3-15 s. Anything that calls `get_upcoming_tracks` / `get_lyrics` / `next` on track-change should wait ~1.5-2 s before firing so it doesn't pile onto the stuck channel and starve user-driven IPCs (`get_playlist`, `search`) that the user is clicking right then.
