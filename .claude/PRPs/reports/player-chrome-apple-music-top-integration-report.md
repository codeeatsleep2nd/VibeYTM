# Implementation Report: Player Chrome — Apple Music Top-Integrated Layout

## Summary
Replaced the bottom `PlayerBar` with a top-integrated `PlayerChrome` matching Apple Music's macOS player chrome. The new chrome is a single 56px-tall horizontal strip at the top of the window (replacing both the empty title-bar drag region AND the 72px bottom bar). It contains: 80px traffic-light reservation, 5 flat SVG transport icons (no filled circles), a centered rounded "Now Playing display" card with embedded cover + title + artist + elapsed/remaining times + 2px progress bar, then 4 small flat utility icons (volume slider with dynamic speaker glyph, like, lyrics, queue). All optimistic-update, planned-next/prev, preload, seek-while-paused, and bridge-volume-lock behavior preserved verbatim.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large (matched) |
| Confidence | 8/10 | Single-pass, no deviations |
| Files Changed | 9 (3 new, 6 modified, 1 deleted) | 6 changed (3 new, 2 modified, 1 deleted) — NowPlaying.tsx and QueuePanel.tsx needed no changes (token retag handled them automatically) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | SVG icon library | Complete | 14 icons, all `currentColor`, all `aria-hidden` |
| 2 | Tokens (title-bar 56, player-bar 0) | Complete | Comment added explaining the 0px retention |
| 3 | Apple-Music slider CSS | Complete | `data-vibeytm-slider` attribute scoped |
| 4 | NowPlayingCard widget | Complete | Embedded progress, tabular-nums times, all seek workarounds preserved |
| 5 | PlayerChrome component | Complete | Drag region on outer header, traffic-light reserve on left, all handlers verbatim |
| 6 | Wire AppShell | Complete | PlayerBar import → PlayerChrome; old drag-region div removed; bottom mount removed |
| 7 | Delete old PlayerBar | Complete | Confirmed only AppShell imported it; comment refs in other files left as historical breadcrumbs |
| 8 | Token-only sweep | Complete | Zero `#`/`rgb()`/`rgba()` literals in new files |
| 9 | Live verification | Pending user-driven manual checks (chrome rendering, drag, transport, etc.) — typecheck/build/test/cargo all green |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`pnpm typecheck`) | Pass | Zero TS errors |
| Unit Tests (`pnpm test`) | Pass | 27 tests, 4 files, all green; no new tests added per plan (UI-only redesign) |
| Frontend Build (`pnpm build`) | Pass | 70 modules, 291 KB JS / 3.4 KB CSS, ~580 ms |
| Rust Check (`cargo check`) | Pass | Pre-existing dead-code warnings only |
| Rust Tests (`cargo test --lib`) | Pass | 93 passed |
| Integration / Edge Cases | Pending | Tauri dev restarted; live UI verification in next session unless user requests immediate check |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/components/icons/index.tsx` | CREATED | +130 |
| `src/components/player/NowPlayingCard.tsx` | CREATED | +180 |
| `src/components/layout/PlayerChrome.tsx` | CREATED | +355 |
| `src/components/layout/AppShell.tsx` | UPDATED | +14 / −24 |
| `src/styles/tokens.css` | UPDATED | +5 / −2 |
| `src/styles/global.css` | UPDATED | +51 / 0 |
| `src/components/layout/PlayerBar.tsx` | DELETED | −720 |

Total net: ~+715 / −746 → small reduction in source despite the full redesign (icon library + NowPlayingCard split keeps each file focused).

## Deviations from Plan
**None — implemented exactly as planned.**

The only minor adjustments were:
- `IconProps` type uses `Omit<SVGProps, 'width'|'height'>` to make the `size` prop authoritative without TS yelling about duplicate width/height. This is a typing nicety, not a behavior change.
- `aria-pressed` added to all `ChromeButton`s (planned-but-not-explicitly-spelled in the plan); harmless improvement.

## Issues Encountered
**None.** Type-check passed clean after every file write; the single import grep before deletion confirmed PlayerBar had only the one importer (AppShell).

## Tests Written
None. The plan explicitly deferred unit tests for this UI-only redesign — the surface is styled JSX with side-effectful IPC calls, and the existing contract test (`LoadingOverlay.test.tsx` for the WKWebView no-transform rule) is unaffected.

| Test File | Tests | Coverage |
|---|---|---|
| (none added) | 0 | — |

## Next Steps
- [ ] Live UI verification in Tauri dev (the running app at task `b7o0ft8sn`): chrome at top, drag works, all interactions per the manual checklist
- [ ] Bump version 0.9.4 → 0.9.5 (per CLAUDE.md versioning rule)
- [ ] Commit + push
- [ ] Optional: `/code-review` for an independent quality check before commit
