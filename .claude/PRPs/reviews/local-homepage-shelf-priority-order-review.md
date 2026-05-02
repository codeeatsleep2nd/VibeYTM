# Local Code Review: Pin priority shelves to the top of Home

**Reviewed**: 2026-05-02
**Branch**: `new-features`
**Decision**: APPROVE (with one nit auto-fixed)

## Summary
Render-time reorder of YTM home shelves to pin three personal shelves
("Listen again", "Your daily discovery", "Albums for you") to the top.
Pure helper, no backend changes, no mutation of cached state. Clean,
covered by 8 unit tests, typecheck passes, no regressions in 215 tests.
Approved.

## Files Reviewed

| File | Change | Lines |
|---|---|---|
| `src/components/pages/HomePage.tsx` | Modified | +37 / -1 |
| `src/components/pages/HomePage.test.tsx` | Added | +79 |
| `.claude/PRPs/plans/completed/homepage-shelf-priority-order.plan.md` | Added (plan archive) | — |
| `.claude/PRPs/reports/homepage-shelf-priority-order-report.md` | Added (report) | — |

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
**1. Test framework convention drift** — `HomePage.test.tsx` originally
used `test(...)` from vitest while every other test file in the project
uses `it(...)` (verified across 10 test files including
`PlayerChrome.test.tsx`, `Sidebar.test.tsx`, `splitMode.test.tsx`).
**Auto-fixed in this review** — switched all 8 cases to `it(...)`. Tests
re-run, 8/8 still pass.

### LOW
**2. Pre-existing React-key collision risk** — the render at
`HomePage.tsx:415` uses `key={shelf.title}` for the shelf list. If YTM
ever returns two shelves with the same title in a single response (e.g.
continuation pages re-emitting a shelf), React will warn about duplicate
keys. This is **pre-existing** — not introduced by this PR — but the
dedup logic in `reorderShelves` only handles the priority-title overlap
case. Two non-priority shelves with the same title would still collide.
Not worth fixing in this PR; would be cleaner addressed by the file's
`renderShelfContent` rather than the reorder helper. Filed as LOW for
future awareness.

**3. Per-render computation** — `reorderShelves(shelves)` runs on every
render. With ~10–20 shelves it's a single linear pass and trivially
cheap. The plan explicitly chose not to memoize, citing dep-array
maintenance overhead vs negligible CPU cost. Confirmed appropriate —
no change needed.

## Validation Results

| Check | Result |
|---|---|
| Type check (`pnpm typecheck`) | Pass — zero errors |
| Lint | N/A — project uses TS errors as the lint gate |
| Tests (HomePage.test.tsx) | Pass — 8/8 |
| Full test suite (`pnpm test`) | Pass — 215/215 across 24 files, no regressions |
| Build | Skipped — frontend-only, exercised by `pnpm tauri build` at release |

## Category-by-Category

| Category | Notes |
|---|---|
| Correctness | Pure function, edge cases covered (empty, all-priority, none-priority, missing, case/whitespace, duplicate). Sparse-array handling via `filter(Boolean)` is right. De-dupe via `seen` correctly keeps first occurrence. |
| Type Safety | All types explicit. `Shelf[]` → `Shelf[]`. `as const` on tuple cast for Map constructor. No `any`. No unsafe casts. |
| Pattern Compliance | Mirrors `MOOD_TABS` (module `as const`), `getGreeting` (co-located helper), comment style (inline `//`, no JSDoc). Test conventions matched after the auto-fix. |
| Security | No user input, no IPC, no DOM injection, no untrusted data flow. N/A. |
| Performance | O(n) single pass per render. ~10–20 items typical. No optimization needed. |
| Completeness | All plan tasks done. Tests written. No `console.log`. No TODO/FIXME. No emoji. |
| Maintainability | Function 18 lines (limit 50). File 581 lines (limit 800). Comment explains why (case/whitespace tolerance, drift). No magic numbers. No deep nesting (max 2 levels). |

## Decision Rationale

Zero CRITICAL/HIGH issues. One MEDIUM auto-fixed in-review. One pre-existing LOW
issue noted but out of scope. Validation green. **APPROVE.**

## Next Steps
- [ ] User visual verification on running app (only the actual signed-in YTM home can confirm the three shelves pin in the right order)
- [ ] Bump patch version (`1.1.21` → `1.1.22`) in `package.json` + `src-tauri/tauri.conf.json` per CLAUDE.md when committing
- [ ] `/prp-commit` or `/prp-pr`
