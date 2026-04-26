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
  - Run the full validation suite: `pnpm typecheck`, `pnpm test` (vitest), `cd src-tauri && cargo check`, `cargo test --lib`. Test counts are intentionally not pinned here — they grow with every PR; trust the runner output, not the docs.
  - Trace the previously-fixed code paths against the latest diff to confirm no regression of earlier bugs.
- When extra runtime visibility is needed, add a debug line via the bridge's `log()` ring (writes to `window.__VIBEYTM_DEBUG__`, surfaced by the Rust poller in dev-server output) — do NOT instruct the user to open WebView devtools and paste output.
- If something truly cannot be verified without the user (e.g. "does the lyric sync feel right by ear?"), say so explicitly: "I cannot verify X — please report what you observe" — instead of generically asking them to test.
- Before touching any file that has been the subject of repeated bug reports (especially `QueuePanel.tsx`, the bridge, and `playerApi`), re-read the full file and write down the invariants it depends on. Don't edit only the diff target.
- After each round of fixes, walk every previously-reported bug related to that area against the current code and confirm in the response that each prior fix is still in place — line numbers cited.

## Conflict Detection — ASK BEFORE DECIDING
Before implementing ANY new feature ask or bug-fix ask, scan whether it conflicts with an existing feature or established invariant. Examples that count as conflicts:
- The new ask reverses or weakens a rule documented in CLAUDE.md (e.g. "never show video thumbnails", "use real `<button>`, not `<div role=\"button\">`", "no `transform` on `ReloadOverlay` children").
- The new ask changes the cache lifetime of a value another feature depends on for correctness (e.g. "load lyrics from cache only" while another feature relies on remote refresh).
- The new ask changes the source of truth for state another component reads (e.g. switching artwork from the registry to a fresh IPC when the registry was specifically introduced to avoid that IPC).
- The new ask is the inverse of a fix shipped earlier in the same session (e.g. re-introducing always-on probes that were dropped to fix bridge saturation).

When a conflict is detected, **STOP and ask the user** — phrase the conflict explicitly ("X would undo Y from commit Z; want to proceed, refine the new ask, or revert Y?") and wait for their decision. Do NOT silently pick one side. Conflicts that look minor on the diff often reintroduce the very bug the prior fix closed; the user owns that trade-off.

## Visual fidelity to external products — VERIFY before designing
When the ask is "make UI match X" (Apple Music, Spotify, YouTube Music, iOS Now Playing, etc.), do NOT design from memory. Memory of a third-party UI is unreliable — button shapes drift, layouts get wrong from old screenshots in training data, and "I think it looks like…" produces ugly approximations that the user has to send you back to redo. Before writing any plan or component:

1. **Pull a real reference.** Use Chrome DevTools MCP (`new_page` → `take_screenshot` of the real product, e.g. music.apple.com), open the actual app side-by-side, or fetch the vendor's design-system page. Save the screenshot to `/tmp/` so it can be re-read this turn.
2. **Inventory what you see** — name every visible element, its position, shape, color, and approximate size. Write the inventory into the plan or a scratch doc; don't carry it only in your head.
3. **Don't assume position.** "Apple Music chrome" doesn't mean "moved to the top" unless the user says so. Ask which dimensions of the reference to mirror (visual treatment vs. layout vs. position) before committing to architecture-changing moves.
4. **Don't invent SF-Symbol glyphs from Unicode.** SF Symbols ≠ Unicode codepoints — `↻` is `arrow.clockwise` (reload), not `repeat`. Either ship inline SVG that matches the actual SF Symbol shape (verified against a reference), or use a vendored icon set whose mapping you've confirmed visually.
5. **Show the user a mockup before writing code.** When the redesign is non-trivial, paste an ASCII mockup or a labeled screenshot annotation and let them confirm direction. A wrong mockup is a 30-second correction; a wrong implementation is a multi-file revert.

If you skipped any of the above and the user pushes back with "that's not what X looks like," stop iterating on memory — go fetch a real screenshot before the next attempt.

## Search GitHub before implementing — REUSE BEFORE INVENT
Before designing or coding ANY non-trivial feature, search GitHub (and other registries — npm/crates.io/etc.) for existing implementations or open-source clones that already solve the same problem. Apple Music desktop wrappers, lyrics scrobblers, queue scrapers, IPC bridges — almost everything VibeYTM does has been done before, often by people who actually use the upstream service every day and have already worked around its quirks. Use these as references for:

1. **Visual fidelity** — desktop wrappers (e.g. `Alex313031/apple-music-desktop`, `wimpysworld/sidra`, `revblaze/AppleMusicUltra`) embed the real product UI, so their screenshots are ground truth and their style files often capture the design tokens.
2. **API behavior & quirks** — YTM bridge / Innertube clients (e.g. ytmusicapi, sigma67, th-ch/youtube-music) have already documented the response shapes and the edge cases.
3. **Implementation patterns** — when you'd otherwise hand-roll something (e.g. a queue dedupe, a media-key handler, a notification provider), check whether a small library or a referenced source-snippet already does it correctly.

Always run `gh search repos`, `gh search code`, or a targeted web search BEFORE writing the plan — not after the user pushes back. Cite the references you used in the plan so future-you can re-verify. If no existing implementation matches, document what you searched for so the absence is recorded, not assumed.

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
- **Seek echoes can arrive 1-4 s late and must not snap state backward.** When the user clicks the progress bar, YTM's bridge sometimes emits stale pre-seek POSITION_UPDATED events while its `<video>.currentTime` is still buffering. The first version of the filter used a fixed 800 ms window — too short — and let echoes through that snapped `useSmoothedPosition` backward, scrolling the lyric panel to a stale line for several seconds. The current rule is: while a seek is pending (set by `markSeek()`), drop every POSITION_UPDATED that's > `SEEK_TOLERANCE_SECS` from the target until either (a) we see a near-target position (clears the pending flag), or (b) `SEEK_RECONCILE_WINDOW_MS` (5 s) elapses (hard cap). The decision logic lives in `src/hooks/seekFilter.ts` as a pure function — keep it pure and add a test in `seekFilter.test.ts` for any new edge case before changing the constants.
- **Bridge `player:track-changed` fires on metadata refinement, not just real track changes.** The poller in `src-tauri/src/webview_bridge/poller.rs` re-emits the track-changed event whenever `duration` grows or `title`/`artist`/`artwork` is refined. The FE's `usePlayerState` filter for stale post-track-change positions must therefore gate `lastTrackChangeAtRef` updates on **`isSameTrack === false`** (videoId actually changed). Treating every emit as a real track change drops every legitimate POSITION_UPDATED for 1.5 s after a metadata refinement — including the post-seek positions, leaving the lyric panel pinned to the pre-seek time. Don't remove the `if (!isSameTrack)` guard around `lastTrackChangeAtRef.current = Date.now()`.
- **User-control state pushed to YTM via IPC must also be persisted to YTM-origin `localStorage` so the bridge can seed it on every page load BEFORE the new `<video>` element exists.** YTM destroys the page context on every track navigation. Globals like `__VIBEYTM_DESIRED_VOLUME_PCT__` are wiped, the prototype-level `volume`/`muted` lock no-ops, and the user hears the new track at default volume for ~one poll cycle until Rust re-pushes the value. The fix is two-sided: (1) in the bridge JS, write the value to `localStorage` on every `set_*` IPC, AND (2) at the very top of `ytm-player-bridge.js` (which Tauri runs as `initialization_script` on every navigation), seed the global from `localStorage` BEFORE the volume lock installs. Any new control surface that has to survive YTM page nav (volume, mute, lyric offset, shuffle, repeat, etc.) needs the same seed-then-persist pair — the IPC alone is too late.
