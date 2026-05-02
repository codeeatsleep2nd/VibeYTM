# Plan: Pin priority shelves to the top of the Home page

## Summary
The Home page renders YTM home shelves in whatever order the YTM `FEmusic_home`
endpoint returns, which means user-personal shelves like "Listen again",
"Your daily discovery", and "Albums for you" can land anywhere on the page —
sometimes below "Quick picks", sometimes below editorial mood shelves. Pin
those three to the top, in that order, and keep every other shelf in its
original backend order beneath them.

## User Story
As a VibeYTM user, I want my personalized shelves ("Listen again",
"Your daily discovery", "Albums for you") to always sit at the top of the
Home page, so that I can resume my own listening without scrolling past
editorial sections.

## Problem → Solution
Today the shelf order is whatever YTM returns → priority shelves are
hoisted client-side before render, the rest preserve their original order.

## Metadata
- **Complexity**: Small (single file, ~20 lines, no new dependencies)
- **Source PRD**: N/A (free-form ask)
- **PRD Phase**: N/A
- **Estimated Files**: 1 source + 1 test

---

## UX Design

### Before
```
┌──────────────────────────────────────────────┐
│ [Greeting + mood tabs plate]                 │
├──────────────────────────────────────────────┤
│ Quick picks                  ← editorial    │
│ Trending community playlists ← editorial    │
│ Listen again                 ← personal     │
│ Your daily discovery         ← personal     │
│ Albums for you               ← personal     │
│ Mixed for you                               │
│ Forgotten favorites                         │
│ ... etc                                     │
└──────────────────────────────────────────────┘
```

### After
```
┌──────────────────────────────────────────────┐
│ [Greeting + mood tabs plate]                 │
├──────────────────────────────────────────────┤
│ Listen again                 ← priority #1  │
│ Your daily discovery         ← priority #2  │
│ Albums for you               ← priority #3  │
│ Quick picks                  ← rest, in     │
│ Trending community playlists    backend     │
│ Mixed for you                   order       │
│ Forgotten favorites                         │
│ ... etc                                     │
└──────────────────────────────────────────────┘
```

If one or more priority shelves are absent from the YTM response (e.g. user is
signed out, fresh account, or YTM dropped that shelf this session), the
remaining priority shelves still pin to the top in order, and non-priority
shelves render below — no empty placeholder rows.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home scroll first viewport | YTM order | Priority shelves pinned | Priority order is fixed: Listen again → Your daily discovery → Albums for you |
| Refresh button | Re-fetches in YTM order | Re-fetches, same reorder applied | Reorder is render-time, not fetch-time — applies to both fresh and cached shelves |
| Mood tab (non-"All") | No shelves rendered | No shelves rendered | Reorder only affects the `activeMood === 'All'` branch, no change to mood-search rendering |
| Sign-out / sign-in flush | Shelves cleared, refetched | Same, then reordered | Existing flush behavior in `useTauriEvent('player:login-changed')` is unchanged |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/components/pages/HomePage.tsx` | 378-383 | Current render loop — the reorder happens immediately upstream of this map |
| P0 | `src/components/pages/HomePage.tsx` | 30-36 | Module-level cache of `cachedShelves` — reorder must NOT mutate cached array |
| P0 | `src/lib/types.ts` | 132-141 | `Shelf` and `ShelfContent` shapes (`title: string`, discriminated `items` union) |
| P1 | `src/components/pages/HomePage.tsx` | 119-139 | `useEffect`/login-change flow — shows the reorder must be derived, not stored |
| P1 | `src/components/pages/HomePage.tsx` | 327-376 | Mood-tab branch — confirm reorder lives only in the `activeMood === 'All'` branch |
| P2 | `src-tauri/src/ytm_api/mod.rs` | 136-175 | Backend `get_home` — confirms shelf titles come straight from YTM, not normalized |

## External Documentation
None needed — feature uses internal patterns only.

---

## Patterns to Mirror

### MODULE_CONSTANTS_PATTERN
// SOURCE: src/components/pages/HomePage.tsx:31-50
```typescript
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PERSIST_KEY = 'home:shelves';
// ...
const MOOD_TABS = [
  'All',
  'Energize',
  // ...
] as const;
```
Module-level `const` arrays/strings declared as `as const` with comments
explaining intent. The new `PRIORITY_TITLES` constant follows the same
shape.

### SHELF_RENDER_PATTERN
// SOURCE: src/components/pages/HomePage.tsx:378-383
```typescript
{activeMood === 'All' &&
  shelves.map((shelf) => (
    <ShelfRow key={shelf.title} title={shelf.title}>
      {renderShelfContent(shelf, onOpenPlaylist)}
    </ShelfRow>
  ))}
```
The render uses `shelf.title` as the React key, so the reordered array must
preserve unique titles. (YTM home titles are unique within a single response
in practice, but we'll defensively dedupe by title in case continuation pages
ever return the same shelf twice.)

### IMMUTABLE_DERIVATION_PATTERN
// SOURCE: src/components/pages/HomePage.tsx:69-77
```typescript
const [shelves, setShelves] = useState<Shelf[]>(cachedShelves ?? []);
// ...
const [moodSongs, setMoodSongs] = useState<TrackInfo[]>(
  cachedMoodSongs && cachedMoodSongs.mood === lastActiveMood
    ? cachedMoodSongs.songs
    : [],
);
```
State is set from immutable inputs without mutating module-level caches.
The reorder must NOT mutate `cachedShelves` or the `shelves` state array —
return a new array.

### TEST_STRUCTURE
// SOURCE: src/components/layout/PlayerChrome.test.tsx (referenced from CLAUDE.md WKWebView section, around the "Next bypasses planned queue when shuffle is on" test)
Tests live next to the component, file pattern `<Component>.test.tsx`,
import from `vitest` (the project uses `pnpm test` → vitest per CLAUDE.md
verification discipline). Pure functions are unit-tested; the reorder
function will be a pure function so it can be tested without rendering React.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/components/pages/HomePage.tsx` | UPDATE | Add `PRIORITY_TITLES` constant + `reorderShelves` pure helper; call it inside the render loop |
| `src/components/pages/HomePage.test.tsx` | CREATE | Unit-test `reorderShelves` against the four scenarios in the Edge Cases checklist |

## NOT Building
- A user-facing setting to customize the priority list. Three titles are hard-coded per the user's ask. If/when more customization is needed, extend the constant.
- Any backend change. The Rust `get_home` endpoint stays untouched — reordering is render-time only.
- Removing or hiding non-priority shelves. Everything YTM returns still renders.
- Smart matching across locales (e.g. translated YTM strings). The user runs YTM in English; if a localized YTM ever returns "Daily Mix" / "Wieder anhören" / etc., the fallback is the existing YTM order — no broken UI, just no pin.
- Mood-tab reorder. The mood-tab branch renders search results, not home shelves; no priority concept applies.

---

## Step-by-Step Tasks

### Task 1: Add `PRIORITY_TITLES` constant and pure `reorderShelves` helper
- **ACTION**: Add a module-level `PRIORITY_TITLES` constant and a pure helper `reorderShelves(shelves: Shelf[]): Shelf[]` in `src/components/pages/HomePage.tsx`.
- **IMPLEMENT**:
  ```typescript
  // Three personal shelves users want pinned to the top of Home, in this
  // exact display order. Match is case-insensitive and trim-tolerant — YTM
  // sometimes returns trailing whitespace and capitalization drifts.
  const PRIORITY_TITLES = [
    'Listen again',
    'Your daily discovery',
    'Albums for you',
  ] as const;

  function reorderShelves(shelves: Shelf[]): Shelf[] {
    const norm = (s: string) => s.trim().toLowerCase();
    const priorityIndex = new Map(
      PRIORITY_TITLES.map((title, i) => [norm(title), i]),
    );

    const pinned: Shelf[] = [];
    const rest: Shelf[] = [];
    const seen = new Set<string>();

    for (const shelf of shelves) {
      const idx = priorityIndex.get(norm(shelf.title));
      if (idx !== undefined && !seen.has(norm(shelf.title))) {
        pinned[idx] = shelf;
        seen.add(norm(shelf.title));
      } else {
        rest.push(shelf);
      }
    }

    // pinned may contain holes if some priority shelves are absent — drop them
    return [...pinned.filter(Boolean), ...rest];
  }
  ```
- **MIRROR**: `MODULE_CONSTANTS_PATTERN` (lines 31-50) and `IMMUTABLE_DERIVATION_PATTERN` (lines 69-77). Pure function, no mutation of input.
- **IMPORTS**: No new imports — `Shelf` is already imported on line 2.
- **GOTCHA**: Do NOT call `Array.prototype.sort` with a comparator that returns the priority index — `sort` is not stable across all engines for equal keys, AND a comparator-based approach forces O(n log n) plus has to compute `priorityIndex` lookups twice per pair. Build two arrays in a single pass.
- **GOTCHA**: `pinned[idx] = shelf` creates a sparse array when some priority titles are missing. `filter(Boolean)` collapses the holes; do NOT use `pinned.length` checks — that includes holes.
- **GOTCHA**: De-dupe by normalized title via `seen` so a continuation that re-emits the same shelf (defensive — YTM continuation pages occasionally do this) doesn't overwrite the first occurrence.
- **VALIDATE**: `pnpm typecheck` — no type errors. Function is exported (or made testable via re-export) so the test file can import it.

### Task 2: Apply reorder in the render loop
- **ACTION**: Replace `shelves.map(...)` at HomePage.tsx:379 with `reorderShelves(shelves).map(...)`.
- **IMPLEMENT**:
  ```typescript
  {activeMood === 'All' &&
    reorderShelves(shelves).map((shelf) => (
      <ShelfRow key={shelf.title} title={shelf.title}>
        {renderShelfContent(shelf, onOpenPlaylist)}
      </ShelfRow>
    ))}
  ```
- **MIRROR**: `SHELF_RENDER_PATTERN` (lines 378-383). Render shape unchanged; only the source array is reordered.
- **IMPORTS**: None.
- **GOTCHA**: Reorder is computed on every render. With ~10–20 shelves the cost is trivial (single linear pass). Do NOT memoize unless profiling shows it matters — premature `useMemo` adds dep-array maintenance with no real win at this size.
- **GOTCHA**: Do NOT call `reorderShelves` inside `setShelves(...)` (i.e. don't bake the reorder into state). Keeping `shelves` state as the raw backend order means future ordering tweaks (or a user-controllable priority list) only need to touch the helper, not the fetch path.
- **GOTCHA**: Do NOT mutate `cachedShelves` (module-level on line 34) — `reorderShelves` already returns a new array, but Task 1's implementation must keep the input untouched so the persistent cache stays in canonical YTM order.
- **VALIDATE**: `pnpm typecheck`. Then `pnpm tauri dev`, sign in, scroll Home — first three sections should be the priority titles in order; remaining sections should match the prior YTM order.

### Task 3: Unit-test `reorderShelves`
- **ACTION**: Create `src/components/pages/HomePage.test.tsx` with vitest-style tests for the pure helper. Export `reorderShelves` from `HomePage.tsx` (named export) so the test can import it without rendering.
- **IMPLEMENT**: Write tests for the four scenarios in the Edge Cases section. Use minimal `Shelf` fixtures (only `title` and a stub `items` are needed — tests assert on title order, not content).
  ```typescript
  import { describe, expect, test } from 'vitest';
  import { reorderShelves } from './HomePage';
  import type { Shelf } from '../../lib/types';

  const stubItems: Shelf['items'] = { kind: 'Songs', data: [] };
  const shelf = (title: string): Shelf => ({ title, items: stubItems });

  describe('reorderShelves', () => {
    test('pins all three priority shelves in the configured order', () => {
      const input = [
        shelf('Quick picks'),
        shelf('Albums for you'),
        shelf('Trending community playlists'),
        shelf('Listen again'),
        shelf('Your daily discovery'),
      ];
      const out = reorderShelves(input).map((s) => s.title);
      expect(out).toEqual([
        'Listen again',
        'Your daily discovery',
        'Albums for you',
        'Quick picks',
        'Trending community playlists',
      ]);
    });

    test('keeps non-priority shelves in their original backend order', () => {
      const input = [shelf('A'), shelf('B'), shelf('Listen again'), shelf('C')];
      const out = reorderShelves(input).map((s) => s.title);
      expect(out).toEqual(['Listen again', 'A', 'B', 'C']);
    });

    test('falls through gracefully when priority shelves are missing', () => {
      const input = [shelf('Quick picks'), shelf('Listen again')];
      const out = reorderShelves(input).map((s) => s.title);
      expect(out).toEqual(['Listen again', 'Quick picks']);
    });

    test('matches case-insensitively and tolerates trailing whitespace', () => {
      const input = [
        shelf('quick picks'),
        shelf('  Albums For You  '),
        shelf('LISTEN AGAIN'),
      ];
      const out = reorderShelves(input).map((s) => s.title);
      expect(out).toEqual(['LISTEN AGAIN', '  Albums For You  ', 'quick picks']);
    });

    test('does not mutate input array', () => {
      const input = [shelf('A'), shelf('Listen again')];
      const snapshot = input.map((s) => s.title);
      reorderShelves(input);
      expect(input.map((s) => s.title)).toEqual(snapshot);
    });

    test('dedupes when the same priority title appears twice', () => {
      const input = [
        shelf('Listen again'),
        shelf('Quick picks'),
        shelf('Listen again'),
      ];
      const out = reorderShelves(input).map((s) => s.title);
      // First occurrence wins; the duplicate falls into rest, preserving its order
      expect(out).toEqual(['Listen again', 'Quick picks', 'Listen again']);
    });
  });
  ```
- **MIRROR**: `TEST_STRUCTURE` — co-located `<Component>.test.tsx` next to component (matches existing tests like `PlayerChrome.test.tsx`, `Sidebar.test.tsx`).
- **IMPORTS**: `vitest`, `Shelf` type, `reorderShelves`.
- **GOTCHA**: The function must be exported. Add `export` to its declaration in HomePage.tsx — do NOT introduce a separate utility file unless `reorderShelves` grows beyond ~30 lines. Keeping it in HomePage.tsx mirrors the project's preference for co-locating helpers (e.g. `getGreeting` on line 62).
- **VALIDATE**: `pnpm test src/components/pages/HomePage.test.tsx` — all six tests pass.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Pins all 3 priorities | mixed array containing all 3 | `[L, Y, A, ...rest in order]` | No |
| Preserves rest order | input has 1 priority + 3 others | `[priority, A, B, C]` | Yes — confirms stability |
| Missing priorities | input has only "Listen again" + 1 other | `[Listen again, other]` (no holes) | Yes — sparse-array trap |
| Case / whitespace | `'LISTEN AGAIN'`, `'  Albums For You  '` | Pinned correctly | Yes — YTM wording drift |
| No mutation | snapshot input before, compare after | Input unchanged | Yes — cachedShelves invariant |
| Duplicate priority title | `'Listen again'` appears twice | First wins, second goes to rest | Yes — continuation defensive |

### Edge Cases Checklist
- [ ] Empty `shelves` array → returns `[]`
- [ ] All shelves are priority shelves → all pinned, no rest
- [ ] No shelves are priority shelves → identity (same order, new array)
- [ ] Some priority shelves missing → no holes in output
- [ ] Mixed case + whitespace → still pinned
- [ ] Same priority shelf appears twice → first wins
- [ ] Mutation of input → never happens

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
```
EXPECT: Zero type errors.

### Unit Tests
```bash
pnpm test src/components/pages/HomePage.test.tsx
```
EXPECT: 6/6 tests pass.

### Full Test Suite
```bash
pnpm test
```
EXPECT: No regressions in any other test file.

### Manual Validation
- [ ] `pkill -f "tauri dev" 2>/dev/null; pkill -f "VibeYTM" 2>/dev/null; sleep 1; pnpm tauri dev` (only if module-level state needs reset; otherwise rely on Vite HMR — see CLAUDE.md "Dev Workflow")
- [ ] Sign in (or use existing session) and load Home
- [ ] First section title is "Listen again" (or whichever of the three is present first)
- [ ] Following two sections are "Your daily discovery" then "Albums for you" (when present)
- [ ] Below those, the original YTM order resumes ("Quick picks", "Trending community playlists", etc.)
- [ ] Sign out → home flushes → re-renders without the priority shelves but does NOT crash
- [ ] Tap "↻ Refresh" → reorder still applied to the new fetch
- [ ] Tap a non-"All" mood tab → mood search renders normally (reorder doesn't fire in that branch)
- [ ] Tap "All" mood tab → reorder still applied

---

## Acceptance Criteria
- [ ] `PRIORITY_TITLES = ['Listen again', 'Your daily discovery', 'Albums for you']` declared at module level in HomePage.tsx
- [ ] `reorderShelves` is a pure, exported function — no mutation of input, no module-level state read inside
- [ ] Render loop at HomePage.tsx:379 calls `reorderShelves(shelves)` instead of using `shelves` directly
- [ ] All 6 unit tests pass
- [ ] `pnpm typecheck` passes
- [ ] Manual smoke test on Home shows the three shelves at the top in order

## Completion Checklist
- [ ] Code follows discovered patterns (module constants, pure helpers, immutable derivation)
- [ ] No mutation of `cachedShelves` or `shelves` state
- [ ] Tests co-located in `HomePage.test.tsx`
- [ ] No backend (Rust) changes
- [ ] No new dependencies
- [ ] No `console.log` statements
- [ ] No version bump needed for plan generation; bump patch in `package.json` + `src-tauri/tauri.conf.json` when implementing

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| YTM changes one of the three shelf titles | Low | One shelf no longer pinned | Case-insensitive + trim-tolerant match absorbs casing/whitespace drift; semantic renames will surface as a missing pin and can be patched in `PRIORITY_TITLES` |
| Localized YTM accounts return non-English titles | Medium for non-en accounts | Priority pin no-ops, falls back to YTM order | Documented in NOT Building; expand constant if it becomes an issue |
| Cached shelf array gets reordered by accident | Low | Persistent cache + in-memory cache drift across reloads | `reorderShelves` is pure, returns new array; covered by "does not mutate input" test |
| Sparse-array bug from `pinned[idx] = shelf` when priorities are missing | Low | Empty placeholder rows | `filter(Boolean)` drops holes; covered by "missing priorities" test |
| Future continuation page emits a duplicate priority shelf | Low | Duplicate render with same React key | `seen` set + first-wins; second occurrence falls into rest, preserving uniqueness within the pinned head |

## Notes
- This is intentionally render-time, not fetch-time. Keeping the cache in canonical YTM order means a future "user-customizable priority list" feature can swap `PRIORITY_TITLES` for state without touching the network or persistent-cache layer.
- The user verified externally on music.youtube.com that personalized shelves only appear signed in. The signed-out fallback (no priority shelves to pin) is exercised by the "missing priorities" test.
- No Chrome DevTools MCP capture was needed — the user already named the three exact title strings; the helper's case/whitespace tolerance is enough to absorb minor YTM wording drift.
