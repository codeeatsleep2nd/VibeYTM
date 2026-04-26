# Implementation Report: Fix Next-Button vs Visible-Queue Mismatch

## Summary
Player-Bar **Next** now plays the explicit first track of the visible Up-Next list (within the active playlist context) instead of delegating to YTM's `nextVideo()`. **Previous** walks a small playback-history stack maintained automatically by `usePlayerState`'s TRACK_CHANGED handler. Both fall back to the original IPC commands when the queue/history is empty.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium ✓ |
| Confidence | 9/10 | 10/10 — single-pass, no rework |
| Files Changed | 5 | 4 (CLAUDE.md not touched as planned) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | History stack in `ipc.ts` | [done] Complete | `HISTORY_LIMIT = 50`, dedup-by-same-id guard |
| 2 | `nextFromQueue` / `previousFromHistory` helpers | [done] Complete | Reuses `playerApi.playTrack(vid, getActivePlaylistId())` |
| 3 | TRACK_CHANGED pushes outgoing track | [done] Complete | Inside `setState` callback so `prev.track` is read atomically |
| 4 | Wire PlayerBar buttons | [done] Complete | `queue` destructured from `usePlayerState` return |
| 5 | QueuePanel row-click comment | [done] Complete | Comment-only — history flows via central TRACK_CHANGED |
| 6 | Validation | [done] Complete | typecheck clean, cargo test 78/78 |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`pnpm typecheck`) | [done] Pass | Zero errors |
| Unit Tests (`cargo test --lib`) | [done] Pass | 78 / 78 |
| Build (`cargo check`) | [done] Pass | Existing warnings only (no new) |
| Integration | N/A | Frontend behavior change; manual smoke required |
| Edge Cases | [done] Coded | Empty queue / current-not-in-queue / empty history all fall back to IPC |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/ipc.ts` | UPDATED | +51 / −2 (history stack + 2 new methods) |
| `src/hooks/usePlayerState.ts` | UPDATED | +9 / −1 (TRACK_CHANGED pushes prev.track) |
| `src/components/layout/PlayerBar.tsx` | UPDATED | +9 / −2 (button wiring, `queue` destructured) |
| `src/components/player/QueuePanel.tsx` | UPDATED | +2 / −0 (comment) |

## Deviations from Plan

**None.** Implemented exactly as planned. CLAUDE.md was already noted as NO CHANGE in the plan's Files-to-Change table; the only edit there was an earlier dev-workflow note that's already in main.

## Issues Encountered

- One Edit attempt failed because the file uses `'⏮'` Unicode escapes in the label prop, but the search string used the literal glyph. Worked around by matching only the surrounding lines (without the label) — both Previous and Next handlers updated cleanly on the second attempt.

## Tests Written

No new tests written — per the plan, the project has no frontend test runner configured (`package.json` scripts: only `dev`/`build`/`typecheck`). Coverage relies on:
- Static type-checking (passed).
- Existing 78 Rust unit tests (passed).
- Manual validation checklist in the plan (10 items) — to be executed against the running dev build.

## Manual Validation Checklist (to run)

- [ ] Single track from Home → Next plays #1 of Up-Next.
- [ ] Album Play-All → Next walks the album in order.
- [ ] Real playlist Play-All → Next walks playlist.
- [ ] Click row in queue panel → that track plays; Previous returns to prior.
- [ ] Tail of queue → Next falls back to YTM `nextVideo()`.
- [ ] Cold start → Previous falls back to YTM `previousVideo()`.
- [ ] After 3 Nexts, 3 Previouses retrace the path.

## Next Steps
- [ ] Run manual validation against the dev build.
- [ ] Run `/code-review` if desired.
- [ ] Commit + push to existing `0.9.1` branch (PR #62 already open).
