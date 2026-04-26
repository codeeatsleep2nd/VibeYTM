# Plan: Fix Next-Button vs Visible-Queue Mismatch

## Summary
The Player-Bar **Next** button currently delegates to YTM's internal `player.nextVideo()`. YTM picks its own next track from a server-driven radio that often differs from the queue we render in the Playing-queue panel — so the user sees track B at the top of "Up next" but track X plays. Fix by making **Next** play the explicit first item from the visible queue (when one exists), falling back to `player.nextVideo()` only when no queue is loaded.

## User Story
As a VibeYTM user, I want the **Next** button to play the song I see at the top of the Up Next list, so that the queue I'm shown is actually the queue I'm playing.

## Problem → Solution
**Current:** click Next → YTM's `nextVideo()` → server picks a track from its internal radio. The Playing-queue panel was populated from a separately-fetched `/next` snapshot (or DOM scrape that might be stale), so the two diverge per click.

**Desired:** click Next → if our visible queue has a known next track, navigate to **that exact videoId** within the active playlist context (`navigate_to_track_with_playlist`). The visible queue and the audio agree, click for click. Same for Previous (last-played track popped from a small history stack).

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A (free-form bug fix)
- **PRD Phase**: N/A
- **Estimated Files**: 5

---

## UX Design

### Before
```
┌──────────────────────────────────────────────┐
│ Now Playing: track A                         │
│ Up Next:                                     │
│   1. track B  ← user expects this next       │
│   2. track C                                 │
│ [⏮ ⏯ ⏭]                                       │
└──────────────────────────────────────────────┘
        click ⏭
        ↓
┌──────────────────────────────────────────────┐
│ Now Playing: track X (something unrelated!) │
│ Up Next: refetched, possibly different list │
└──────────────────────────────────────────────┘
```

### After
```
┌──────────────────────────────────────────────┐
│ Now Playing: track A                         │
│ Up Next:                                     │
│   1. track B                                 │
│   2. track C                                 │
│ [⏮ ⏯ ⏭]                                       │
└──────────────────────────────────────────────┘
        click ⏭
        ↓
┌──────────────────────────────────────────────┐
│ Now Playing: track B  ← matches displayed    │
│ Up Next:                                     │
│   1. track C                                 │
└──────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Player-bar `⏭` Next | Calls `player.nextVideo()` blindly | Plays first track of visible Up-Next list, preserving active playlist context | Falls back to `nextVideo()` when queue is empty/unloaded |
| Player-bar `⏮` Previous | Calls `player.previousVideo()` blindly | Pops most-recent track from a small history stack and plays it | Falls back to `previousVideo()` when history empty |
| Queue-panel row click | Already plays clicked track | Unchanged — already correct | The bug fix uses the exact same primitive |
| Auto-advance (track ends) | YTM advances on its own | Unchanged in this scope | YTM's internal advance still drives autoplay — out of scope |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/components/layout/PlayerBar.tsx` | 332-365 | Where the Next/Previous buttons currently call `playerApi.next()` / `previous()` |
| P0 | `src/lib/ipc.ts` | 21-60 | `playerApi.playTrack`, `next`, `previous`, `getActivePlaylistId`, `subscribeActivePlaylist` |
| P0 | `src/components/player/QueuePanel.tsx` | full | Shows how `state.queue` and `fetchedUpcoming` are sliced after `displayTrack.videoId` for the Up-Next list — the same selection logic the next-button needs |
| P0 | `src/hooks/usePlayerState.ts` | full | The single React hook exposing `track`, `queue`, etc. — the new logic must read state from here |
| P1 | `src-tauri/src/commands/player.rs` | 149-200 | `forward_to_ytm`, `next_track`, `previous_track`, `play_track` — confirms there is no Rust-side queue cursor; YTM is canonical for `nextVideo()` |
| P1 | `src-tauri/src/webview_bridge/mod.rs` | 73-128 | `navigate_to_track`, `navigate_to_track_with_playlist` — the primitive Next/Previous will reuse |
| P2 | `scripts/inject/ytm-player-bridge.js` | 195-205 | Bridge dispatcher for `'next'` / `'previous'` (current behavior we are layering over, not removing) |

## External Documentation

No external research needed — feature uses established internal patterns (existing `playerApi.playTrack`, `usePlayerState`, queue state pipeline).

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: src/lib/ipc.ts:21-60
export const playerApi = {
  play: () => invoke('play'),
  pause: () => invoke('pause'),
  togglePlay: () => invoke('toggle_play'),
  next: () => invoke('next_track'),
  previous: () => invoke('previous_track'),
  ...
  playTrack: (videoId: string, playlistId?: string) => { ... },
};
```
Camel-case methods on the `playerApi` object; React component code calls them through `playerApi.<method>()`. New helpers go on the same object or as exported async functions in the same file.

### ACTIVE_PLAYLIST_TRACKING
```ts
// SOURCE: src/lib/ipc.ts (existing)
let activePlaylistId: string | null = null;
const activePlaylistListeners = new Set<ActivePlaylistListener>();
export function getActivePlaylistId(): string | null { return activePlaylistId; }
export function subscribeActivePlaylist(listener) { ... }
function setActivePlaylistId(id: string | null): void {
  if (id === activePlaylistId) return;
  activePlaylistId = id;
  for (const listener of activePlaylistListeners) listener(id);
}
```
Module-level subscribable singleton. Re-use via `getActivePlaylistId()` when the new Next handler dispatches `playTrack(vid, pl)`.

### STATE_HOOK_USAGE
```ts
// SOURCE: src/components/player/QueuePanel.tsx (existing)
const { track, queue: liveQueue } = usePlayerState();
const currentVideoId = track?.videoId;
// ...
const idx = liveQueue.findIndex((t) => t.videoId === currentVideoId);
const upcoming = idx >= 0
  ? liveQueue.slice(idx + 1)
  : liveQueue.filter((t) => t.videoId !== currentVideoId);
```
The same slicing logic is what the Next handler needs — given `(state.queue, currentVideoId)`, the next track is `queue[idx+1]`.

### OPTIMISTIC_PLAY_DISPATCH
```ts
// SOURCE: src/components/player/QueuePanel.tsx — handleRowClick
setPendingCurrent(t);
const pl = getActivePlaylistId() ?? undefined;
playerApi.playTrack(t.videoId, pl).catch(() => {
  setPendingCurrent(null);
});
```
Existing pattern for "play a specific track within the current playlist". The Next/Previous handlers will mirror this exactly (without `pendingCurrent` since the Player-Bar doesn't render row-level optimistic state).

### TAURI_COMMAND_FORWARD
```rust
// SOURCE: src-tauri/src/commands/player.rs:149-200
fn forward_to_ytm(app: &AppHandle, cmd: &str) {
    if let Some(window) = crate::webview_bridge::get_ytm_window(app) {
        if let Err(e) = crate::webview_bridge::exec_playback_command(&window, cmd) {
            tracing::warn!(command = cmd, error = %e, "failed to forward command to YTM");
        }
    }
}

#[tauri::command]
pub async fn next_track(app: AppHandle) -> Result<(), String> {
    forward_to_ytm(&app, "next");
    Ok(())
}
```
Rust commands stay thin pass-throughs; the smart logic lives in the frontend (where queue state already lives).

### TEST_STRUCTURE (Rust)
```rust
// SOURCE: src-tauri/src/ytm_api/mod.rs:2342+ (existing tests module)
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_duration_text_mm_ss() {
        assert_eq!(parse_duration_text("3:45"), 225.0);
    }
}
```
No frontend test runner is configured (`package.json` has only `dev`, `build`, `typecheck`). Unit tests for new TS logic stay manual / typecheck-only; Rust-side helpers (none added in this plan) would slot into the existing `mod tests` block.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/ipc.ts` | UPDATE | Add `nextFromQueue` / `previousFromHistory` helpers + a small history stack |
| `src/components/layout/PlayerBar.tsx` | UPDATE | Wire Next/Previous buttons through the new helpers, falling back to `playerApi.next/previous` |
| `src/components/player/QueuePanel.tsx` | UPDATE (small) | When a row is clicked, also push the previously-current track onto the history stack so Previous can return to it |
| `src/hooks/usePlayerState.ts` | NO CHANGE | `state.queue` already exposes the live queue |
| `CLAUDE.md` | NO CHANGE | Behavior change is internal; no new contract for future sessions |

## NOT Building

- Rewriting `nextVideo()` dispatch in the bridge (`scripts/inject/ytm-player-bridge.js`) — keeping the existing `'next'` / `'previous'` commands intact as a fallback path.
- Backend (Rust) queue cursor — YTM remains the source of audio truth; we only override which **specific videoId** to navigate to.
- Auto-advance when a track finishes — that still flows through YTM's internal next; only user-initiated Next/Previous is targeted here.
- DOM scrape changes (`__VIBEYTM_QUEUE__` pull pipeline added in the prior session stays as-is).
- Frontend test runner setup (out of scope; project has no Vitest/Jest configured).

---

## Step-by-Step Tasks

### Task 1: Add a recently-played history stack to `ipc.ts`
- **ACTION**: Introduce a module-level `recentlyPlayed: TrackInfo[]` capped at ~50 items, plus `pushRecentlyPlayed(track)`, `popRecentlyPlayed()`, and `peekRecentlyPlayed()`.
- **IMPLEMENT**:
  ```ts
  const HISTORY_LIMIT = 50;
  const recentlyPlayed: TrackInfo[] = [];
  export function pushRecentlyPlayed(track: TrackInfo): void {
    if (!track.videoId) return;
    // Avoid pushing the same id twice in a row — happens during placeholder + real-track event pairs.
    if (recentlyPlayed[recentlyPlayed.length - 1]?.videoId === track.videoId) return;
    recentlyPlayed.push(track);
    while (recentlyPlayed.length > HISTORY_LIMIT) recentlyPlayed.shift();
  }
  export function popRecentlyPlayed(): TrackInfo | null {
    return recentlyPlayed.pop() ?? null;
  }
  ```
- **MIRROR**: `ACTIVE_PLAYLIST_TRACKING` from "Patterns to Mirror" — same module-level singleton style.
- **IMPORTS**: existing `TrackInfo` type from `./types`.
- **GOTCHA**: Don't push when the videoId is empty (placeholder track during navigation has been observed in the bridge).
- **VALIDATE**: `pnpm typecheck` clean.

### Task 2: Add `playerApi.nextFromQueue` and `playerApi.previousFromHistory`
- **ACTION**: Two helpers on `playerApi` that consult queue/history first and fall through to the existing IPC.
- **IMPLEMENT**:
  ```ts
  // signature lives next to existing `next` / `previous`
  nextFromQueue: (queue: TrackInfo[], currentVideoId: string | undefined): Promise<unknown> => {
    if (currentVideoId && queue.length > 0) {
      const idx = queue.findIndex((t) => t.videoId === currentVideoId);
      const next = idx >= 0 ? queue[idx + 1] : queue[0];
      if (next?.videoId) {
        const pl = getActivePlaylistId() ?? undefined;
        return playerApi.playTrack(next.videoId, pl);
      }
    }
    return invoke('next_track');
  },
  previousFromHistory: (): Promise<unknown> => {
    const prev = popRecentlyPlayed();
    if (prev?.videoId) {
      const pl = getActivePlaylistId() ?? undefined;
      return playerApi.playTrack(prev.videoId, pl);
    }
    return invoke('previous_track');
  },
  ```
- **MIRROR**: `STATE_HOOK_USAGE` (slicing the queue against currentVideoId) and `OPTIMISTIC_PLAY_DISPATCH` (re-uses `playerApi.playTrack`).
- **IMPORTS**: existing module-internal helpers.
- **GOTCHA**: When `idx === queue.length - 1` (current track is the last), `queue[idx+1]` is `undefined` — fall through to `invoke('next_track')` so YTM's autoplay/radio extends the queue.
- **VALIDATE**: TypeScript clean; manual: clicking Next on the last visible queue item still advances (via fallback).

### Task 3: Track-changed handler pushes the previous track onto history
- **ACTION**: Whenever `state.track.videoId` changes, push the OUTGOING track onto `recentlyPlayed`.
- **IMPLEMENT**:
  ```ts
  // src/hooks/usePlayerState.ts — inside TRACK_CHANGED handler
  useTauriEvent<TrackInfo>(EVENTS.TRACK_CHANGED, (track) => {
    lastTrackChangeAtRef.current = Date.now();
    setState((prev) => {
      if (prev.track && prev.track.videoId !== track.videoId) {
        pushRecentlyPlayed(prev.track);
      }
      return { ...prev, track, positionSecs: 0 };
    });
  });
  ```
- **MIRROR**: existing `useTauriEvent<TrackInfo>(EVENTS.TRACK_CHANGED, ...)` body in `usePlayerState`.
- **IMPORTS**: `import { pushRecentlyPlayed } from '../lib/ipc';`
- **GOTCHA**: The first TRACK_CHANGED after `play_track` is a placeholder (`title: "Loading..."`). Title is filler but `videoId` is correct, so it still de-dupes correctly thanks to the same-id guard in `pushRecentlyPlayed`.
- **VALIDATE**: `pnpm typecheck` clean. Manual: skip forward 3 tracks via Next, then click Previous 3 times — should retrace.

### Task 4: Wire PlayerBar Next/Previous buttons
- **ACTION**: Replace direct `playerApi.next()` / `playerApi.previous()` calls in `PlayerBar.tsx` with the queue-aware variants.
- **IMPLEMENT**:
  ```tsx
  // PlayerBar.tsx — read queue from usePlayerState (already returned)
  const { track, queue, ... } = state; // already destructured if not, add it
  ...
  <TransportButton
    label={'⏮'}
    ariaLabel="Previous"
    onClick={() => playerApi.previousFromHistory()}
  />
  ...
  <TransportButton
    label={'⏭'}
    ariaLabel="Next"
    onClick={() => playerApi.nextFromQueue(queue, track?.videoId)}
  />
  ```
- **MIRROR**: existing `<TransportButton label={'⏭'} ariaLabel="Next" onClick={() => playerApi.next()} />` shape — only the handler changes.
- **IMPORTS**: none new — `state` already includes `queue` because `usePlayerState` returns the full PlayerState.
- **GOTCHA**: `state.queue` may include the currently-playing track at some position; `nextFromQueue` finds the index by `currentVideoId` and steps past it. If the current track isn't in the queue (rare; happens during YTM's transient navigation), the helper falls through to `invoke('next_track')`.
- **VALIDATE**: Click Next while the queue panel shows a known Up-Next track. The track that plays MUST equal that Up-Next track. Click Previous afterward — must return to the prior track.

### Task 5: QueuePanel row-click pushes the outgoing track onto history
- **ACTION**: Confirm Task 3's handler covers this implicitly (since clicking a row triggers a TRACK_CHANGED that goes through the same path). No change needed in QueuePanel — but add a comment near `handleRowClick` that the history is auto-maintained.
- **IMPLEMENT**: comment-only.
  ```ts
  // src/components/player/QueuePanel.tsx — handleRowClick body
  // History for Player-Bar Previous is maintained centrally in
  // usePlayerState's TRACK_CHANGED handler; no manual push needed.
  ```
- **MIRROR**: N/A.
- **IMPORTS**: none.
- **GOTCHA**: None — TRACK_CHANGED fires for both `playTrack` and YTM's autoplay, so the history covers all cases.
- **VALIDATE**: After clicking 3 rows in the queue, click Previous on the player bar — should walk the row-click history.

### Task 6: Manual smoke-test the integrated flow
- **ACTION**: Restart `pnpm tauri dev` (per CLAUDE.md, restart is reserved for Rust/bridge-JS changes — none here, so HMR is sufficient). Manually validate.
- **IMPLEMENT**: N/A (validation only).
- **MIRROR**: N/A.
- **IMPORTS**: N/A.
- **GOTCHA**: HMR may not re-evaluate the `recentlyPlayed` array on hot replace if the user is mid-session; if state looks stuck, do a manual page reload.
- **VALIDATE**: see Manual Validation checklist below.

---

## Testing Strategy

### Unit Tests
The project has no frontend test runner configured (`package.json` shows only `dev`/`build`/`typecheck`). Static type-checking is the unit-test surface; behavioral coverage falls to manual smoke-tests.

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| TS typecheck | New `nextFromQueue` / `previousFromHistory` signatures | Zero errors | — |
| Manual: Next with non-empty queue | Queue = [A(now), B, C]; click ⏭ | B plays | golden path |
| Manual: Next at end of queue | Queue = [A, B, C(now)]; click ⏭ | YTM advances via fallback | edge |
| Manual: Previous after 3 Nexts | History = [A, B, C], current = D; click ⏮ ×3 | C → B → A | golden path |
| Manual: Previous with empty history | No prior track; click ⏮ | YTM `previousVideo()` (existing fallback) | edge |
| Manual: Row click in queue | Click row C in [A(now), B, C, D] | C plays; clicking ⏮ returns to A | history auto-populates |

### Edge Cases Checklist
- [x] Empty queue (no tracks loaded yet) — falls back to `invoke('next_track')`
- [x] Current track at last index — falls back
- [x] Current track absent from queue — falls back
- [x] Empty history (cold start) — Previous falls back to `invoke('previous_track')`
- [x] Same videoId pushed twice (placeholder + real track) — de-duped at push site
- [ ] Concurrent rapid Next clicks — covered by `playTrack` already debouncing via the active-playlist sub system; no extra guard needed

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
```
EXPECT: Zero type errors.

### Rust Compile (no Rust changes, but verify nothing broke)
```bash
cd src-tauri && cargo check --quiet
```
EXPECT: Existing warnings only; no new errors.

### Unit Tests (Rust — no new tests added, verify existing pass)
```bash
cd src-tauri && cargo test --lib
```
EXPECT: All 78 tests pass (current count after the v0.7.0+ regression suite).

### Browser Validation
```bash
pnpm tauri dev
```
EXPECT: App launches, no Vite errors in the dev console.

### Manual Validation
- [ ] Play any song from the home page (single-track default → song-radio queue).
- [ ] Open the Playing-queue drawer; note the videoId / title at position #1 of "Up next".
- [ ] Click the Player-Bar Next ⏭ button.
- [ ] Verify the now-playing track equals the noted Up-Next #1.
- [ ] Click Next again. Verify the new now-playing equals the new Up-Next #1.
- [ ] Click Previous ⏮. Verify it returns to the previous track.
- [ ] Click Previous a second time. Verify it returns one step further back.
- [ ] Repeat the full sequence with an album playback (queue context = OLAK).
- [ ] Repeat with an explicit playlist (PL/RDCLAK).
- [ ] At the bottom of a queue (current track is last visible), click Next — verify YTM extends the queue (fallback to `invoke('next_track')`).
- [ ] Reload the app, immediately click Previous — verify it falls back to YTM `previousVideo()` (history empty).

---

## Acceptance Criteria
- [ ] All 6 tasks completed
- [ ] `pnpm typecheck` clean
- [ ] `cargo test --lib` 78/78 passing
- [ ] Clicking Next plays the track shown at top of "Up next" (assuming the queue has a track after the current)
- [ ] Clicking Previous walks back through the user's playback history
- [ ] No regressions on Play-All, row-click, or auto-advance flows
- [ ] App launches via `pnpm tauri dev` without console errors

## Completion Checklist
- [ ] Code follows discovered patterns (subscribable singleton, `playerApi.<method>`, `usePlayerState`-driven UI)
- [ ] Error handling matches codebase style (`.catch(() => {})` for play-dispatch failures)
- [ ] Logging follows codebase conventions (no console.log; Rust side already logs `play_track called`)
- [ ] Tests follow test patterns (manual checklist for UI; Rust tests untouched but verified passing)
- [ ] No hardcoded values (history limit named `HISTORY_LIMIT`)
- [ ] Documentation updated (none required; behavior is internal)
- [ ] No unnecessary scope additions (didn't touch the bridge dispatcher, autoplay, or DOM scrape)
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `state.queue` is empty when YTM's DOM scrape hasn't fired yet (cold-start race) | Medium | User clicks Next, fallback to `invoke('next_track')` plays YTM's pick — same as today | Acceptable degradation; the current YTM track still advances. |
| Same videoId appears twice in queue (rare playlist quirk) | Low | `findIndex` returns the first occurrence, `idx+1` skips a valid second copy | Negligible — playlists with intentional duplicates are rare; YTM also struggles with them. |
| Placeholder TRACK_CHANGED fires during fast clicks, polluting history | Low | History contains a videoId with title `"Loading..."` | Same-id guard in `pushRecentlyPlayed` plus the placeholder having a real videoId means Previous still navigates to the right track. |
| Auto-advance pushes its own outgoing track onto history (good), but Previous after auto-advance lands on the same track YTM would have anyway | Low | No user-visible difference | Intentional; matches user mental model. |

## Notes
- This plan deliberately keeps the existing `playerApi.next` / `playerApi.previous` IPC surface intact as a fallback. We do NOT remove `next_track` / `previous_track` Tauri commands — they're still invoked when our queue/history doesn't have an answer.
- The auto-advance path (track ends → YTM picks next) is unchanged; YTM will still drive the queue when it loops past what we showed. Whatever YTM picks then becomes the new `track` and the QueuePanel's slicing logic adapts.
- After implementation, the `TEST_CHECKLIST.md` should pick up the new manual-validation steps as a regression checklist for v0.9.2.
