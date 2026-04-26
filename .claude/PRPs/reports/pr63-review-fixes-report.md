# Implementation Report: PR #63 Review Fixes

## Summary
Addressed the consolidated multi-agent review findings on PR #63
(`v0.9.2: fix unclickable cards (WKWebView quirk) + interactive reload`):
3 critical fixes, 6 important fixes, 3 minor cleanups, plus a new
9-test suite for the lyrics title/artist cleanup function flagged as
the suspected root cause of the still-open APT/ROSÉ wrong-lyrics bug.

## Tasks Completed

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | `setVolume` optimistic-revert (`PlayerChrome.tsx`, mute toggle + slider) | Complete | Both call sites now revert on IPC failure |
| 2 | Narrow about-window capability (separate `capabilities/about.json`) | Complete | Removed `"about"` from `default.json`; new capability has only `core:default` + `opener:default` |
| 3 | Update banner re-emit suppression (track last-emitted version in Rust loop) | Complete | FE was already correct; this is a BE-side IPC-traffic optimization |
| 4 | About temp-file path (move from `/tmp` → `app_cache_dir`) | Complete | Eliminates the `/tmp` race-write window |
| 5 | Silent-failure logging — 4 spots | Complete | `webview_bridge/poller.rs` JSON parse, `ytm_api/mod.rs` explore continuation, `lib.rs` opener call, `ytm-player-bridge.js` IPC catch |
| 6 | Tests: `clean_query_field` (suspected APT/ROSÉ bug root cause) | Complete | 9 new cases — Official MV stripping, full-width brackets, dash-tail cuts, whitespace collapse, alias preservation |
| 7a | Strengthen `about_info_serializes_with_snake_case_keys` test | Complete | Now asserts both expected keys AND total key count via `obj.len() == EXPECTED_KEYS.len()` |
| 7b | Fix `AlbumSummary.year` type drift (TS `number` → `string`) | Complete | Wire format matches Rust `Option<String>`; comment added against future re-drift |
| 8 | Comment rot — 4 spots | Complete | NowPlaying PlayerBar references → NowPlayingCard/PlayerChrome; lib.rs "bottom player" → "player chrome"; muda comment pinned to "as of muda 0.17.2"; CLAUDE.md test counts removed |
| 9 | Minor — QueuePanel close `<button>` `type="button"` | Complete | |
| 10 | Minor — Remove unnecessary type cast in `bootstrapActivePlaylistFromState` | Complete | |

## Deferred (not in this pass)

- **Replace `console.error` with `debug.error`** — pre-existing pattern is `console.error`. Migrating would touch unrelated files; left for a focused cleanup PR.
- **`UpdateBanner` dismiss persistence test** — needs React Testing Library scaffolding the project doesn't have yet.
- **`NowPlaying` `splitMode` shallow render test** — same React testing harness gap.
- **`check_once` IPC integration test** — would require mocking the GitHub API; out of scope.

## Validation Results

| Level | Status | Notes |
|-------|--------|-------|
| TypeScript (`pnpm typecheck`) | Pass | 0 errors |
| Vitest (`pnpm test`) | Pass | 42/42 (no new tests added on FE this pass — frontend tests for components require harness work) |
| Cargo check | Pass | Only pre-existing `unused_imports` / `dead_code` warnings |
| Cargo test (`cargo test --lib`) | Pass | **119/119** (was 110; +9 from `clean_query_field`) |
| Dev-server boot | In progress | Background task `b2zs9lbfd` |

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/components/layout/PlayerChrome.tsx` | UPDATED | `.catch(() => revert)` on both setVolume call sites |
| `src-tauri/capabilities/default.json` | UPDATED | Removed `"about"` from windows list |
| `src-tauri/capabilities/about.json` | CREATED | Narrow capability for about window |
| `src-tauri/src/updater/mod.rs` | UPDATED | Last-emitted version tracking in `spawn_update_checker` |
| `src-tauri/src/lib.rs` | UPDATED | `app_cache_dir` for about.html, opener error logging, muda version pin, "bottom player" comment fix |
| `src-tauri/src/webview_bridge/poller.rs` | UPDATED | JSON parse failure now logs |
| `src-tauri/src/ytm_api/mod.rs` | UPDATED | Explore continuation logs both error paths; +9 `clean_query_field` tests |
| `scripts/inject/ytm-player-bridge.js` | UPDATED | IPC catch routes through `log()` ring |
| `src-tauri/src/commands/about.rs` | UPDATED | Strengthened serialization test (key count) |
| `src/lib/types.ts` | UPDATED | `year?: string` (was `number`) + drift-protection comment |
| `src/components/player/NowPlaying.tsx` | UPDATED | Stale `PlayerBar` doc fixes |
| `src/components/player/QueuePanel.tsx` | UPDATED | `type="button"` on close button |
| `src/lib/ipc.ts` | UPDATED | Removed unnecessary type-widening cast |
| `CLAUDE.md` | UPDATED | Removed pinned test counts |

## Issues Encountered
None. All review findings were straightforward applies; the validation
suite caught zero regressions.

## Next Steps
- Commit + push (`/prp-commit` + `/prp-pr`, or just `git push` to update PR #63)
- Open follow-up issues for the deferred items (FE component tests,
  `console.error` → `debug.error` cleanup)
