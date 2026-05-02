# PR Review: #97 — feat(home): pin Listen again / Daily discovery / Albums for you to top

**Reviewed**: 2026-05-02
**Branch**: `new-features` → `main`, HEAD `f55b207`
**Scope**: 27 files, +1839 / -174, 12 commits
**Decision**: APPROVE with optional fixes

## Summary
Mature, thoroughly tested PR. Two backend types added (`HistorySection`, optional fields on `TrackInfo`), three new FE components/helpers (`reorderShelves`, `bucketHistorySections`, `EpisodeRow`, `ExpandableDescription`), four overlay/CSS fixes targeting WKWebView paint flicker, plus content tweaks (Songs hidden in sidebar). 217 → 229 unit tests, 5 new Rust parser tests, 0 regressions. No CRITICAL or HIGH defects in production code; the CRITICAL items below are missing-test gaps that would let a real bug regress, not actual bugs today.

---

## Findings (deduped, confidence ≥ 80)

### CRITICAL — must fix before merge if you want regression safety

None.

### HIGH — should fix before merge

**H1. EpisodeRow swallows playback errors silently** (`src/components/browse/EpisodeRow.tsx:47`)
`playerApi.playTrack(...).catch(() => {})` discards every failure with no log, no debug.error, no user feedback. A user taps an episode → nothing plays → indistinguishable from success. Fix: route to `debug.error('EpisodeRow', 'playTrack failed', e)` like other components do.

**H2. SafeOverlay `willChange` lifecycle has zero test coverage** (`src/components/overlay/SafeOverlay.tsx:143-150` + `SafeOverlay.test.tsx`)
The new `transitioning` state + 480 ms `setTimeout` is the lynchpin of the issue #99 fix. Existing tests assert pointer-events, transform, aria-hidden — but `willChange` is silent. A future edit that breaks the cleanup or flips the timer logic re-opens the WKWebView paint flicker with no test catch. Add a vi.useFakeTimers test asserting:
- mount → `willChange: 'opacity, transform'` (transitioning)
- advance 480 ms → `willChange: 'auto'`
- flip `isOpen` → `willChange: 'opacity, transform'` again
- rapid re-flip cancels the prior demote (no stale timer fires)

**H3. PlaylistDetailPage `isShow ? EpisodeRow : SongRow` branch is untested** (`src/components/pages/PlaylistDetailPage.tsx:425-438`)
A regression flipping the condition (or breaking the `MPSPP*` check) silently renders music rows for podcasts. Add a render test with mocked `getPlaylist` returning an `MPSPP*` playlist; assert `EpisodeRow` is mounted and `SongRow` is not.

### MEDIUM — quality improvements

**M1. `collect_history_section` uses parallel `if let` instead of `if / else if`** (`src-tauri/src/ytm_api/mod.rs:2139-2158`)
If a JSON node ever carries both `musicCarouselShelfRenderer` AND `musicShelfRenderer` (malformed/future shape drift), both branches push, duplicating the section. Today's YTM doesn't do this; trivially fixed by `else if`.

**M2. `reorderShelves` not memoized** (`src/components/pages/HomePage.tsx:424`)
HistoryPage memoizes its bucketing result; HomePage doesn't. Recomputed on every mood-tab change, mood-songs load, etc. No user-visible impact at current shelf counts (~15-20). Wrap in `useMemo([shelves])` for consistency.

**M3. Stale doc on `YtmApi::get_history`** (`src-tauri/src/ytm_api/mod.rs:265-270`)
Docstring says parsing reuses `parse_library_songs`; the function actually calls `parse_history_grouped`. Misleading for any future maintainer.

**M4. `LyricsPanel.tsx:47-50` has a half-finished sentence in `CONTAINER_STYLE` comment** (`src/components/player/NowPlaying/LyricsPanel.tsx`)
The "Fill the full content height of the overlay…" sub-comment trails off mid-thought ("…the panel's bottom edge aligns") and contradicts the actual padding (`var(--space-6)` uniform). Replace with the SafeOverlay-owns-the-frame block that's already in the file just below.

**M5. `formatEpisodeDuration` doc claims MM:SS sub-minute fallback** (`src/components/browse/EpisodeRow.tsx:17-19`)
The function returns `"N sec"` for sub-minute clips, not MM:SS. Fix the docstring.

**M6. `bucketHistorySections` doc says "last 7 days" but the implementation looks back 6 days** (`src/components/pages/HistoryPage.tsx:33-35,54`)
After Today + Yesterday are exact-matched, the date range is `[today - 6 days, yesterday]`. Either rename `sevenDaysAgo` → `sixDaysAgo` or update the doc.

**M7. ExpandableDescription has no test coverage at all** (`src/components/DetailPageHero.tsx`)
Three behaviors should be pinned: button hidden when text fits, visible when it overflows, toggle expands/collapses. jsdom + mocked `ResizeObserver` makes this tractable.

**M8. Episode duration fallback walks all runs but only one shape is tested** (`src-tauri/src/ytm_api/mod.rs:3502-3510`)
`parse_episode_from_multi_row_handles_secondtitle_shape` covers `[" • ", "5 min"]` (parseable at index 1). Two uncovered paths: parseable-at-index-0 (`["5 min", " • "]`) and all-non-parseable (`[" • "]` → expect 0). Quick to add.

### LOW — nits / advisories

**L1. SafeOverlay context comment cites `NowPlaying.tsx` (file no longer exists)** (`src/components/overlay/SafeOverlay.tsx:17`)
The flat file was split into `NowPlaying/index.tsx`. Drop the line number; the directory reference is enough.

**L2. PRIORITY_TITLE_ALIASES typed as nested ReadonlyArray instead of tuple** (`src/components/pages/HomePage.tsx:66-77`)
Slot index is load-bearing (slot 0 = Listen again, slot 1 = Discovery, slot 2 = Albums). A tuple `readonly [readonly string[], readonly string[], readonly string[]]` would catch slot insertions/deletions at compile time. Type-design improvement, not a bug.

**L3. `BucketKey` private inside HistoryPage but `bucketHistorySections` is exported** (`src/components/pages/HistoryPage.tsx`)
A consumer/test that wants to annotate `BucketKey` has to duplicate it. Export it alongside.

**L4. HomePage mood-search catch silently sets empty array with no log** (`src/components/pages/HomePage.tsx:212-218`)
**Pre-existing** — not introduced by this PR. Flag for awareness; out of scope.

**L5. PRIORITY_TITLE_ALIASES verification timestamp ages out** (`src/components/pages/HomePage.tsx`)
The "verified 2026-05-02" comment will be wrong the moment YTM renames a shelf. Consider rephrasing as a procedure (re-verify via REORDER-DIAG when YTM updates) rather than asserting current values.

### Code simplification candidates (advisory only — accept or reject)

**S1. `reorderShelves` two-pass with sparse array → `Map<number, Shelf>` collected at end** (`HomePage.tsx:89-104`)
Eliminates the `filledSlots` set, the sparse write, and the trailing `.filter(Boolean)`.

**S2. `parse_episode_from_multi_row` empty-string → `Option<String>` boilerplate** (`src-tauri/src/ytm_api/mod.rs:3479-3483, 3519-3523`)
Two if-let-else blocks could be `(!s.is_empty()).then_some(s)` one-liners.

**S3. `ExpandableDescription` two effects with same body** (`DetailPageHero.tsx:400-418`)
`useLayoutEffect` (initial) and `useEffect` (resize) share identical measurement logic. Single `measure()` callback called from both eliminates duplication.

**S4. `HistoryPage` `totalTracks` outside the `useMemo`** (`HistoryPage.tsx:119`)
Computed via `reduce` every render while `buckets` is memoized from the same `sections`. Return `{ buckets, totalTracks }` from a single memo pass.

---

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Type check (`pnpm typecheck`) | Pass | Zero errors |
| Tests (`pnpm test`) | Pass | 229/229 across 25 files |
| Tests (`cargo test --lib`) | Pass | 207/207 (5 new) |
| Lint | N/A | Project relies on TS errors as the gate |
| Build | Skipped | Frontend covered by HMR; release builds via `pnpm tauri build` at ship time |

## Files Reviewed
27 files. Significant new code in:
- `src/components/pages/HomePage.tsx` (+37/-1) — reorderShelves
- `src/components/pages/HistoryPage.tsx` (+200/-50) — buckets + grouped UI + canonical title plate
- `src/components/browse/EpisodeRow.tsx` (new, +154)
- `src/components/DetailPageHero.tsx` (+95) — ExpandableDescription + back-button marker
- `src/components/overlay/SafeOverlay.tsx` (+22) — willChange demote
- `src-tauri/src/ytm_api/mod.rs` (+~150) — parse_history_grouped + episode shape detection
- `src-tauri/src/state/player.rs` (+8) — TrackInfo new fields
- `src/styles/global.css` (+25) — body:has() rules

## Decision Rationale
Zero CRITICAL findings; the three HIGH items are silent-failure-on-error (H1) and missing tests for the lynchpin lifecycle changes (H2/H3). H1 is a 1-line fix; H2/H3 are 30-60 lines of test code each. None block merge; all are good guard-rails before this work hits main.

The MEDIUM list is mostly comment rot from rapid iteration (M3-M6) and one parallel-if defensive fix (M1). The LOW list is mostly type-design nuance and a pre-existing bug (L4). Code-simplifier proposals are nice-to-have, not blocking.

**Recommended action**: land H1 + a test for the `isShow` branch (H3) before merge; defer H2 (SafeOverlay willChange tests), the comment cleanups (M3-M6), and simplification (S1-S4) to a follow-up PR if the merge window is tight.
