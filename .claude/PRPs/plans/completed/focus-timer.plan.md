# Plan: Focus Timer overlay

## Summary
Add a focus-timer surface accessible from the player chrome. A new clock button sits adjacent to the queue button; clicking it opens a full-page overlay (mirroring `NowPlaying`'s slide-from-bottom + heavy backdrop-blur style). The user picks a duration with a slider (5–120 min, 5 min steps, default 25), clicks **Start**, and watches a countdown. Music playback is left entirely to the user. When the timer hits 0, a macOS system notification fires ("You made it, time to take a break"), and the overlay stays open showing **Done** until dismissed. Any attempt to close the overlay while a non-zero countdown is running pops a confirmation modal warning that exiting resets the timer; once dismissed, all state resets to defaults. Single-shot, in-process only — no persistence across app restart, no history.

Bundles a small unrelated fix the user asked for in the same breath: the **Settings → "Sign in to YouTube Music"** button now uses the direct-to-Google sign-in URL instead of `showYtm()` alone.

## User Story
As a VibeYTM user, I want a built-in focus timer so I can run a Pomodoro-style session inside my music app, get a system notification when the time is up, and never accidentally lose my session by clicking the wrong thing.

## Problem → Solution
**Current**: VibeYTM has no concept of a focus session. Users wanting a Pomodoro alongside their music run a separate timer app.
**Desired**: A first-class focus surface in the chrome, with a minimal slider → start → countdown → done flow that respects user music control and uses macOS-native notifications already wired into VibeYTM.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: standalone
- **Estimated Files**: ~10 changed/new (4 Rust, 6 frontend incl. tests)

---

## UX Design

### Before
```
┌─ Player chrome (bottom) ─────────────────────────────────┐
│  [⏮ ⏯ ⏭]  …track…              [♥ 🔊 📜 ☰]            │
│                                  Like Vol Lyrics Queue   │
└──────────────────────────────────────────────────────────┘
```

### After
```
┌─ Player chrome (bottom) ─────────────────────────────────┐
│  [⏮ ⏯ ⏭]  …track…              [♥ 🔊 📜 🕐 ☰]         │
│                                  Like Vol Lyrics Focus Q │
└──────────────────────────────────────────────────────────┘
                             │
                             ▼ click 🕐
┌─ Focus Timer overlay (slides up from bottom) ────────────┐
│           ┌──────────────────────────────────────┐       │
│           │           Focus session              │       │
│           │                                      │       │
│           │              25:00                   │       │  idle
│           │      ━━━━━━━●━━━━━━━━━━━━━━           │       │
│           │      5            120                │       │
│           │                                      │       │
│           │             [ Start ]                │       │
│           └──────────────────────────────────────┘       │
└───────────────────────────────────────────────────[× ]────┘
                                                    close →

┌─ Focus Timer overlay (counting down) ────────────────────┐
│           ┌──────────────────────────────────────┐       │
│           │           Focus session              │       │
│           │                                      │       │
│           │              22:34                   │       │  running
│           │       ━━━━━━━━━━━●━━━━━━━━━━━━━━     │       │
│           │       (progress mirrors elapsed)     │       │
│           │                                      │       │
│           │             [ Reset ]                │       │
│           └──────────────────────────────────────┘       │
└───────────────────────────────────────────────────[× ]────┘
                                                    close → confirm modal

┌─ Focus Timer overlay (done) ─────────────────────────────┐
│           ┌──────────────────────────────────────┐       │
│           │              Done                    │       │
│           │     You made it, time to             │       │  done
│           │            take a break              │       │
│           │                                      │       │
│           │             [ Close ]                │       │
│           └──────────────────────────────────────┘       │
└───────────────────────────────────────────────────[× ]────┘
                                                    close → no confirm
```

### Confirmation modal (only when state === 'running')
```
        ┌─ Reset focus session? ─────────────────┐
        │                                        │
        │  Closing this page will reset the      │
        │  countdown.                            │
        │                                        │
        │           [ Cancel ]   [ Reset & exit ]│
        └────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Player chrome right cluster | `[lyrics] [queue]` | `[lyrics] [focus] [queue]` | Focus sits between lyrics and queue (adjacent to queue per user) |
| Click clock icon when overlay closed | n/a | Opens overlay; state = `idle`, slider at default 25 min | Resets every time it opens (no persisted slider value) |
| Click clock icon when overlay open (state=idle) | n/a | Closes overlay (no confirm — nothing to lose) | Toggle behaviour mirrors queue button |
| Click clock icon when overlay open (state=running) | n/a | Pops confirmation; on confirm: reset + close | |
| Click clock icon when overlay open (state=done) | n/a | Closes overlay (no confirm — nothing to reset) | |
| Sidebar nav / Cmd+L / any other navigation while running | n/a | Pops confirmation; on confirm: reset + close + perform navigation | "anything in the page can lead to the timer page be closed" — all close paths funnel through the same gate |
| Music transport (play / pause / next / prev) | unchanged | unchanged | "user control" — timer never touches playback |
| Notification on countdown == 0 | n/a | macOS system notification: title `Focus session complete`, body `You made it, time to take a break.` | Existing tauri-plugin-notification capability already granted |
| App quits while running | n/a | Silently reset on next launch | "the timer should reset if the app is closed" — no persistence |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/components/layout/PlayerChrome.tsx` | 28, 66-128, 540-565 | `ChromeButton` API + queue/lyrics button placement; new icon import; new prop wiring |
| P0 | `src/App.tsx` | 35-67, 75-90, 99-105, 130-155, 165-235, 240-252, 305-340 | Owner of `isQueueOpen` / `isLyricsOpen` / `isNowPlayingOpen` state; toggle helpers; sidebar-nav reset; PlayerChrome prop wiring; phase-gated render. The new `isFocusTimerOpen` follows the exact same plumbing |
| P0 | `src/components/player/NowPlaying/index.tsx` | 1-100, 320-385 | The page we're "mirroring" — shows the exact `SafeOverlay` props (`slideFrom="bottom"`, `inset` covering sidebar→bottom, `backdropFilter="blur(40px) saturate(180%)"`, `boxShadow`, `zIndex=80`) |
| P0 | `src/components/overlay/SafeOverlay.tsx` | 33-78, 87-150 | Overlay primitive contract; encodes WKWebView invariants (no `transform: scale`, AND-ed pointer-events with `isOpen`, etc.) |
| P0 | `src/components/icons/index.tsx` | 1-56 | Where to add the lucide → semantic icon re-export. Pattern: `Clock as ClockIcon` |
| P0 | `src-tauri/src/integrations/notifications.rs` | 1-60 | Existing notification path (event-driven, fires on TrackChanged). Shows the `app.notification().builder().title().body().show()` API we'll re-use for the on-demand `show_notification` command |
| P1 | `src-tauri/src/commands/player.rs` | 471-505 | Command shape to mirror: `#[tauri::command] pub async fn ... -> Result<(), String>` thin proxy |
| P1 | `src-tauri/src/lib.rs` | 353-415 | Where to register the new `show_notification` command in `invoke_handler!` |
| P1 | `src/lib/ipc.ts` | 162-210 | Where the new `notificationApi` (or `playerApi.showNotification`) wrapper goes |
| P1 | `src/components/pages/SettingsPage.tsx` | 364 | The Settings sign-in button we're also fixing |
| P1 | `src/components/pages/LoginPage.tsx` | 38-58 | Reference for the `openSignIn` + `showYtm` ordering pattern (Settings will copy this) |
| P2 | `src/components/player/NowPlaying/LyricsPanel.tsx` | all | Confirms the existing pattern for an overlay child that mounts inside `SafeOverlay` and reads `useOverlayOpen()` |
| P2 | `src-tauri/capabilities/default.json` | 1-22 | Confirms `notification:default` is already granted — no capability edits needed |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `tauri-plugin-notification` Rust API | Existing in-tree usage at `src-tauri/src/integrations/notifications.rs:34-39` | `app.notification().builder().title(t).body(b).show()` returns `Result<()>`. Permission is already granted via `notification:default` in `capabilities/default.json` for the `main` and `ytm` windows. No JS package install needed — we add a Rust command and `invoke()` it |

No external research needed beyond the in-tree examples — the feature uses established internal patterns (SafeOverlay, ChromeButton, lucide icons, Rust IPC commands, Tauri notification plugin).

---

## Patterns to Mirror

### CHROME_BUTTON_USAGE
```tsx
// SOURCE: src/components/layout/PlayerChrome.tsx:557-564
<ChromeButton
  label={queueOpen ? 'Hide queue' : 'Show queue'}
  onClick={onToggleQueue}
  isActive={queueOpen}
  size={28}
>
  <QueueIcon size={20} />
</ChromeButton>
```
Mirror exactly for the focus button: `label={focusTimerOpen ? 'Hide focus timer' : 'Show focus timer'}`, `<ClockIcon size={20} />`, sit immediately AFTER the queue button per user ("adjacent to the play queue button").

### ICON_REEXPORT
```tsx
// SOURCE: src/components/icons/index.tsx:38
ListMusic as QueueIcon,
```
Add `Clock as ClockIcon,` in the same export block (alphabetised within the player-chrome group). `Clock` is lucide's clock-face glyph — matches user's "clock face" preference.

### APP_OVERLAY_STATE
```tsx
// SOURCE: src/App.tsx:35-37, 79-86, 102-103, 134-135, 150-151, 312-321
const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
const [isLyricsOpen, setIsLyricsOpen] = useState(false);
const [isQueueOpen, setIsQueueOpen] = useState(false);

const toggleQueue = useCallback(() => {
  setIsLyricsOpen(false);
  setIsQueueOpen((prev) => !prev);
}, []);

// Sidebar nav handler
setIsLyricsOpen(false);
setIsQueueOpen(false);
setIsNowPlayingOpen(false);
```
The new `isFocusTimerOpen` follows the same shape — `useState(false)`, toggle helper, and the **sidebar-nav handler MUST reset it to false** along with the existing three. This is the WKWebView pointer-events invariant documented in CLAUDE.md ("Always AND child pointer-events with the parent's open state … when navigating away via the sidebar, reset every overlay flag").

### SAFE_OVERLAY_FULLSCREEN
```tsx
// SOURCE: src/components/player/NowPlaying/index.tsx:53-78
<SafeOverlay
  isOpen={isOpen}
  ariaLabel="Now playing"
  slideFrom="bottom"
  zIndex={80}
  inset={{
    top: '0',
    left: 'var(--sidebar-width)',
    right: '0',
    bottom: '0',
  }}
  background="transparent"
  backdropFilter="blur(40px) saturate(180%)"
  boxShadow="0 -8px 32px oklch(0% 0 0 / 0.35)"
>
  …content…
</SafeOverlay>
```
Mirror exactly for `FocusTimer` — `ariaLabel="Focus timer"`, same inset (full-bleed of main content area, sidebar visible), same `backdropFilter`, same `slideFrom="bottom"`, same `zIndex={80}`. **DO NOT** add `transform: scale(...)` anywhere on the wrapper or its children — banned by the WKWebView contract test.

### TAURI_COMMAND_THIN_PROXY
```rust
// SOURCE: src-tauri/src/commands/player.rs:481-485
#[tauri::command]
pub async fn show_ytm(app: AppHandle) -> Result<(), String> {
    let window = crate::webview_bridge::get_ytm_window(&app)
        .ok_or("YTM window not found")?;
    crate::webview_bridge::show_ytm_window(&window)
}
```
The new `show_notification` follows the same shape — `pub async fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String>` calling `app.notification().builder()…show().map_err(|e| e.to_string())`.

### NOTIFICATION_BUILDER
```rust
// SOURCE: src-tauri/src/integrations/notifications.rs:34-44
if let Err(e) = app
    .notification()
    .builder()
    .title(&track.title)
    .body(&track.artist)
    .show()
{
    tracing::warn!(error = %e, "failed to show track notification");
}
```
Mirror exactly inside `show_notification`. `tracing::warn!` on failure, return `Err(e.to_string())` so the frontend can surface it (in practice it never fails; permission is granted at app start).

### IPC_CLIENT_WRAPPER
```ts
// SOURCE: src/lib/ipc.ts:162-194
export const playerApi = {
  play: () => invoke('play'),
  …
  setVolume: (level: number) => invoke('set_volume', { level }),
  …
};
```
Add to a new `notificationApi` block (keep it semantically separate from `playerApi` — it's not a player surface):
```ts
export const notificationApi = {
  show: (title: string, body: string) =>
    invoke('show_notification', { title, body }),
};
```

### LOGIN_FLOW_OPEN_SIGN_IN (for the Settings fix bundled with this PR)
```tsx
// SOURCE: src/components/pages/LoginPage.tsx:51-58
const handleReopenSignIn = async () => {
  setError(null);
  try {
    await ytmApi.openSignIn();
    await ytmApi.showYtm();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    setError(`Could not open the sign-in page: ${msg}`);
  }
};
```
The Settings page's button currently calls only `ytmApi.showYtm()`. Replace with `openSignIn` first, then `showYtm` — same ordering, same error swallow (Settings has no error state surface, so `.catch(() => {})` is fine).

### TEST_STRUCTURE_VITEST
```tsx
// SOURCE: src/components/pages/HistoryPage.test.tsx:1-22, 40
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
…
vi.mock('../../lib/ipc', () => ({
  browseApi: { getHistory: () => getHistoryMock() },
}));
const { HistoryPage, bucketHistorySections } = await import('./HistoryPage');
```
The `FocusTimer.test.tsx` mocks `notificationApi` + `useFakeTimers` so we can advance the clock and assert `notificationApi.show` was called once when the countdown hits 0.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src-tauri/src/commands/player.rs` (or new `src-tauri/src/commands/notification.rs`) | UPDATE/CREATE | Add `show_notification` Tauri command. Putting it in `commands/notification.rs` is cleaner; if the team prefers fewer files, append to `player.rs`. Plan picks **new file** for clarity. |
| `src-tauri/src/commands/mod.rs` | UPDATE | `pub mod notification;` |
| `src-tauri/src/lib.rs` | UPDATE | Register `commands::notification::show_notification` in `invoke_handler!` |
| `src/lib/ipc.ts` | UPDATE | Export new `notificationApi.show(title, body)` wrapper |
| `src/components/icons/index.tsx` | UPDATE | Add `Clock as ClockIcon` re-export |
| `src/components/layout/PlayerChrome.tsx` | UPDATE | New props `focusTimerOpen` + `onToggleFocusTimer`; render `<ChromeButton>` between lyrics and queue with `<ClockIcon>` |
| `src/components/player/FocusTimer/index.tsx` | CREATE | Main overlay component — mirrors `NowPlaying` shell, owns the slider/countdown view-state |
| `src/components/player/FocusTimer/FocusTimer.test.tsx` | CREATE | Vitest covering the four state transitions + notification firing + confirm-on-close gate |
| `src/components/player/FocusTimer/useFocusTimerCountdown.ts` | CREATE | Pure hook driving the 1-second tick; returns `{ remainingSecs, state, start, reset }`. Pure logic is unit-testable without rendering. |
| `src/App.tsx` | UPDATE | `isFocusTimerOpen` state + `toggleFocusTimer` + render `<FocusTimer>` next to NowPlaying + reset on sidebar nav + wire props to PlayerChrome |
| `src/components/pages/SettingsPage.tsx` | UPDATE | Replace `() => ytmApi.showYtm()` with the `openSignIn` then `showYtm` pattern |
| `package.json`, `src-tauri/tauri.conf.json` | UPDATE | Patch version bump per CLAUDE.md (code change → bump 1.2.1 → 1.2.2) |

## NOT Building

- **Persistence**: timer state does NOT survive app restart, navigation, or even a sidebar click + return. User confirmed: "the timer should reset if the app is closed."
- **Pause/resume**: explicitly forbidden per user — "user should not be able to pause it."
- **Auto-pause / auto-resume music**: explicitly user-controlled — the timer never touches playback IPCs.
- **Session history / streak counter / Pomodoro auto-cycle**: "once shot."
- **Focus-mode audio (white noise / brown noise / lo-fi)**: not asked for.
- **Cross-window timer / system tray countdown / Touch Bar / menu bar widget**: not asked for.
- **Config UI for default duration**: default is 25 min always; the slider is the config.
- **Sound cue when timer hits 0**: only system notification.
- **Localising the strings**: hard-coded English strings consistent with the rest of the chrome (`"Focus session"`, `"Done"`, `"You made it, time to take a break."`).

---

## Step-by-Step Tasks

### Task 0: Settings sign-in fix (bundled)
- **ACTION**: Edit `src/components/pages/SettingsPage.tsx:364`.
- **IMPLEMENT**:
  ```tsx
  <OutlinedButton
    label="Sign in to YouTube Music"
    onClick={() => {
      ytmApi.openSignIn().catch(() => {});
      ytmApi.showYtm().catch(() => {});
    }}
  />
  ```
- **MIRROR**: LOGIN_FLOW_OPEN_SIGN_IN. Settings has no inline error surface — `.catch(() => {})` is consistent with LoginPage's mount-effect tolerance.
- **IMPORTS**: `ytmApi` is already imported at the top of `SettingsPage.tsx` (line shows `ytmApi.showYtm`). No new imports.
- **GOTCHA**: Don't `await` from inside the inline arrow — `OutlinedButton`'s `onClick` is `() => void`. Fire-and-forget with `.catch` is the right shape.
- **VALIDATE**: Restart dev (Vite HMR is fine for TSX-only); click Settings → "Sign in to YouTube Music"; YTM aux window navigates to `accounts.google.com/ServiceLogin?service=youtube&continue=…/music.youtube.com/` and becomes visible. Same behaviour as LoginPage's "Reopen sign-in page".

### Task 1: Add `ClockIcon` re-export
- **ACTION**: Edit `src/components/icons/index.tsx`.
- **IMPLEMENT**: Add `Clock as ClockIcon,` to the lucide re-export block, keeping it grouped with the player-chrome utility icons (next to `MessageSquareText as LyricsIcon` and `ListMusic as QueueIcon`). Update the JSDoc mapping table at the top with `clock                → Clock`.
- **MIRROR**: ICON_REEXPORT.
- **IMPORTS**: lucide already on the dependency tree — `Clock` ships out of the box.
- **GOTCHA**: lucide ships *many* clock variants (`Clock`, `Clock1`, `Clock2`, …, `ClockArrowUp`, `Clock3`). Use plain `Clock` — it's the closest analogue to SF Symbol `clock` (12-and-3 hands, used by Apple Music's listening-history sidebar). Project rule: "Do not invent SF-Symbol glyphs from Unicode" — `Clock` is the verified lucide match.
- **VALIDATE**: `pnpm typecheck` clean. The icon imports cleanly into PlayerChrome (Task 4).

### Task 2: Create `show_notification` Rust command
- **ACTION**: Create `src-tauri/src/commands/notification.rs`.
- **IMPLEMENT**:
  ```rust
  use tauri::AppHandle;
  use tauri_plugin_notification::NotificationExt;

  /// Fire a macOS system notification on demand. Used by the focus
  /// timer when the countdown hits 0; could be reused later for other
  /// one-shot notifications. Permission is granted via `notification:default`
  /// in capabilities/default.json — no runtime permission prompt.
  #[tauri::command]
  pub async fn show_notification(
      app: AppHandle,
      title: String,
      body: String,
  ) -> Result<(), String> {
      app.notification()
          .builder()
          .title(&title)
          .body(&body)
          .show()
          .map_err(|e| {
              tracing::warn!(error = %e, "failed to show notification");
              e.to_string()
          })
  }
  ```
- **MIRROR**: TAURI_COMMAND_THIN_PROXY + NOTIFICATION_BUILDER.
- **IMPORTS**: As shown above.
- **GOTCHA**: Take `String` (owned) for `title` / `body` — Tauri's IPC deserialiser hands us owned strings, and `.title(&title)` borrows for the builder. Do **not** validate or sanitise the strings — they're never user-typed in this feature; the only caller passes string literals from the focus-timer view.
- **VALIDATE**: `cd src-tauri && cargo check` clean.

### Task 3: Register the command + module
- **ACTION**: Edit `src-tauri/src/commands/mod.rs` (add `pub mod notification;`) and `src-tauri/src/lib.rs` (add `commands::notification::show_notification,` to the `invoke_handler!` macro, in the same block as the other YTM-window commands or in a small "ad-hoc" block — placement is cosmetic).
- **IMPLEMENT**: One line each, conventional placement.
- **MIRROR**: Existing registration pattern (e.g. lib.rs:377-379 where `hide_ytm`, `show_ytm`, `inject_ytm_bridge` group up).
- **IMPORTS**: None.
- **GOTCHA**: Trailing comma inside `tauri::generate_handler!` — every line ends with a comma. Macro errors are obscure if missed.
- **VALIDATE**: `cargo check` clean. `cargo build` produces a runnable binary.

### Task 4: Frontend IPC wrapper
- **ACTION**: Edit `src/lib/ipc.ts`.
- **IMPLEMENT**: Append (after `ytmApi`):
  ```ts
  export const notificationApi = {
    /**
     * Fire a macOS system notification. Permission is granted at app
     * start via the notification:default capability (see
     * src-tauri/capabilities/default.json) — no runtime prompt needed.
     */
    show: (title: string, body: string) =>
      invoke('show_notification', { title, body }),
  };
  ```
- **MIRROR**: IPC_CLIENT_WRAPPER.
- **IMPORTS**: `invoke` already imported at the top of `ipc.ts`.
- **GOTCHA**: Tauri matches commands by the literal string passed to `invoke`. `'show_notification'` MUST be byte-identical to the Rust function name (snake_case). The TS wrapper is camelCase only on the call site.
- **VALIDATE**: `pnpm typecheck` clean; `notificationApi.show("a", "b")` resolves to `Promise<void>`.

### Task 5: Pure countdown hook
- **ACTION**: Create `src/components/player/FocusTimer/useFocusTimerCountdown.ts`.
- **IMPLEMENT**:
  ```ts
  import { useEffect, useRef, useState, useCallback } from 'react';

  export type FocusTimerState = 'idle' | 'running' | 'done';

  export interface UseFocusTimerCountdown {
    state: FocusTimerState;
    /** Total seconds the user picked when they clicked Start. Stable
     *  while running so the progress fraction can be computed without
     *  capturing the slider value at fire time. */
    totalSecs: number;
    /** Seconds left. While idle, equals the slider's current
     *  selection (so the readout previews the chosen duration). */
    remainingSecs: number;
    /** Picks a new duration while idle. No-op while running/done. */
    setDuration: (secs: number) => void;
    /** Latches state -> 'running' and starts the tick. No-op unless
     *  state === 'idle'. */
    start: () => void;
    /** Returns to idle with totalSecs preserved as the slider value
     *  (so the user doesn't have to re-pick if they reset). */
    reset: () => void;
    /** Called by the FocusTimer view exactly once on the
     *  idle->running->done transition to fire the system notification. */
    onComplete?: () => void;
  }

  export interface FocusTimerOptions {
    initialDurationSecs?: number;  // default 25 * 60
    onComplete?: () => void;
  }

  export function useFocusTimerCountdown(
    opts?: FocusTimerOptions,
  ): UseFocusTimerCountdown {
    const initial = opts?.initialDurationSecs ?? 25 * 60;
    const [state, setState] = useState<FocusTimerState>('idle');
    const [totalSecs, setTotalSecs] = useState(initial);
    const [remainingSecs, setRemainingSecs] = useState(initial);
    const onCompleteRef = useRef(opts?.onComplete);
    onCompleteRef.current = opts?.onComplete;

    // Tick once a second while running; stop when remaining hits 0.
    useEffect(() => {
      if (state !== 'running') return;
      const id = window.setInterval(() => {
        setRemainingSecs((prev) => {
          if (prev <= 1) {
            window.clearInterval(id);
            setState('done');
            onCompleteRef.current?.();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => window.clearInterval(id);
    }, [state]);

    const setDuration = useCallback((secs: number) => {
      setState((s) => {
        if (s !== 'idle') return s;
        setTotalSecs(secs);
        setRemainingSecs(secs);
        return s;
      });
    }, []);

    const start = useCallback(() => {
      setState((s) => (s === 'idle' ? 'running' : s));
    }, []);

    const reset = useCallback(() => {
      setState('idle');
      setRemainingSecs(totalSecs);
    }, [totalSecs]);

    return {
      state,
      totalSecs,
      remainingSecs,
      setDuration,
      start,
      reset,
    };
  }
  ```
- **MIRROR**: `src/hooks/useSmoothedPosition.ts` (an existing pure tick hook; uses `requestAnimationFrame` for sub-second smoothness — we use 1Hz `setInterval` because seconds is the readout granularity).
- **IMPORTS**: As shown.
- **GOTCHA**:
  - The `setRemainingSecs` updater MUST decrement to 0 (not below) AND clear the interval inside the updater so a late tick can't re-fire. Don't read `remainingSecs` from closure — stale-state pitfall.
  - Use a `ref` for `onComplete` so changing the callback (e.g. when `notificationApi` identity changes) doesn't restart the interval.
  - **Use `window.setInterval` / `window.clearInterval`** explicitly so TS's DOM types apply (`number`), not Node's (`Timeout` object). Vitest's jsdom env supports this.
  - **No `Date.now()` drift correction**. Setting an interval to 1000ms in jsdom + Vitest's `vi.useFakeTimers()` is exact when ticked manually; production drift over 5–120 min is < 1s — acceptable for a focus timer (not a stopwatch).
- **VALIDATE**: Unit test in Task 7 covers state transitions, tick decrement, and onComplete firing.

### Task 6: FocusTimer overlay component
- **ACTION**: Create `src/components/player/FocusTimer/index.tsx`.
- **IMPLEMENT**: Public component:
  ```tsx
  import { type FC, useEffect, useState } from 'react';
  import { SafeOverlay } from '../../overlay/SafeOverlay';
  import { LiquidGlass } from '@liquidglass/react';
  import { notificationApi } from '../../../lib/ipc';
  import { useFocusTimerCountdown } from './useFocusTimerCountdown';

  interface FocusTimerProps {
    isOpen: boolean;
    onClose: () => void;
  }

  const MIN_SECS = 5 * 60;
  const MAX_SECS = 120 * 60;
  const STEP_SECS = 5 * 60;
  const DEFAULT_SECS = 25 * 60;

  function format(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  export const FocusTimer: FC<FocusTimerProps> = ({ isOpen, onClose }) => {
    const {
      state,
      totalSecs,
      remainingSecs,
      setDuration,
      start,
      reset,
    } = useFocusTimerCountdown({
      initialDurationSecs: DEFAULT_SECS,
      onComplete: () => {
        notificationApi
          .show('Focus session complete', 'You made it, time to take a break.')
          .catch(() => {
            // Notification permission is granted at app start; on the
            // off chance the user has revoked it at the OS level the
            // overlay's "Done" view is still the visual confirmation.
          });
      },
    });

    const [confirmOpen, setConfirmOpen] = useState(false);

    // Reset internal state every time the overlay closes so the next
    // open is always fresh (matches "the timer should reset if the
    // app is closed" — same invariant applied to overlay close).
    useEffect(() => {
      if (!isOpen) {
        // Use a microtask so we don't fight react's strict-mode
        // double-mount in dev.
        Promise.resolve().then(() => reset());
      }
    }, [isOpen, reset]);

    const tryClose = () => {
      if (state === 'running') {
        setConfirmOpen(true);
        return;
      }
      onClose();
    };

    // …render SafeOverlay with the three view-states (idle/running/done)
    // and the confirmation modal. See ascii-mockup at top of plan.
  };
  ```
- **MIRROR**: SAFE_OVERLAY_FULLSCREEN. Use the same `SafeOverlay` props as `NowPlaying`. Centre a `LiquidGlass` card holding the title, time readout, slider/progress, and primary button. Match `NowPlaying`'s typographic treatment: `var(--text-2xl)` for time, `var(--text-base)` for title.
- **IMPORTS**: as shown.
- **GOTCHAs**:
  - **Slider must use `<input type="range">`** with `min={MIN_SECS} max={MAX_SECS} step={STEP_SECS}`, disabled while `state !== 'idle'`. Style via inline style + CSS variables; do NOT introduce a third-party slider lib.
  - **Time readout must be a real `<button>`-free element**. Don't wrap it in something interactive. (CLAUDE.md WKWebView rule is about `<button>` for click targets — not a concern here, but the overlay still needs the no-`transform: scale` invariant on its wrapper.)
  - **The `useEffect`-on-close reset MUST go through the `reset()` returned by the hook**, not via a fresh slider value, so `totalSecs` returns to the user's last-picked value (their slider preference is preserved within a session, only reset across re-opens).
  - **The "Reset" button** in the running-state shows the same modal as the "X close" — both go through `tryClose`. After the user confirms, call `reset()` then `onClose()`. (Per user: "user can either reset the timer or exist the timer" while running — both produce the same outcome; we keep one button labelled "Reset" that prompts before resetting.)
  - **Done state**: NO confirmation modal on close. `tryClose` only prompts when `state === 'running'`.
  - **Confirmation modal**: implement as a sibling absolutely-positioned `<div>` (z-index +1 over SafeOverlay's content) with two buttons. Don't use native `confirm()` — Tauri's WKWebView doesn't render it consistently.
  - **Notification on countdown=0 fires exactly once**. The `onComplete` ref pattern in the hook ensures this. The state transition `running → done` is one-way until `reset()`.
  - **Keyboard**: no shortcuts (user didn't ask). Don't bind Esc — the close button is the single source of truth.
- **VALIDATE**: Visual check via dev server; vitest in Task 7.

### Task 7: Tests
- **ACTION**: Create `src/components/player/FocusTimer/FocusTimer.test.tsx`.
- **IMPLEMENT**:
  ```tsx
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
  import { act, fireEvent, render, screen } from '@testing-library/react';

  const notificationApi = {
    show: vi.fn().mockResolvedValue(undefined),
  };
  vi.mock('../../../lib/ipc', () => ({ notificationApi }));

  // SafeOverlay's effect plumbing assumes a layout pass — stub to a
  // pass-through that respects isOpen.
  vi.mock('../../overlay/SafeOverlay', () => ({
    SafeOverlay: ({ isOpen, children }: { isOpen: boolean; children: any }) =>
      isOpen ? <div data-testid="safe-overlay">{children}</div> : null,
    useOverlayOpen: () => true,
  }));
  vi.mock('@liquidglass/react', () => ({
    LiquidGlass: ({ children }: { children: any }) => <>{children}</>,
  }));

  const { FocusTimer } = await import('./index');

  describe('FocusTimer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      notificationApi.show.mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('idle: slider sets the readout, Start latches running', async () => {
      const onClose = vi.fn();
      render(<FocusTimer isOpen onClose={onClose} />);
      // Default 25:00
      expect(screen.getByText('25:00')).toBeTruthy();
      // Slide to minimum
      fireEvent.change(screen.getByRole('slider'), {
        target: { value: String(5 * 60) },
      });
      expect(screen.getByText('05:00')).toBeTruthy();
      fireEvent.click(screen.getByText(/start/i));
      expect(screen.getByText(/reset/i)).toBeTruthy();
    });

    it('running: hits zero, fires notification, transitions to done', async () => {
      render(<FocusTimer isOpen onClose={() => {}} />);
      // Pick min (5 min) for a quick test
      fireEvent.change(screen.getByRole('slider'), {
        target: { value: String(5 * 60) },
      });
      fireEvent.click(screen.getByText(/start/i));
      // Advance 5 minutes
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });
      expect(notificationApi.show).toHaveBeenCalledTimes(1);
      expect(notificationApi.show).toHaveBeenCalledWith(
        'Focus session complete',
        'You made it, time to take a break.',
      );
      expect(screen.getByText(/done/i)).toBeTruthy();
    });

    it('running: close attempt prompts confirmation', () => {
      const onClose = vi.fn();
      render(<FocusTimer isOpen onClose={onClose} />);
      fireEvent.click(screen.getByText(/start/i));
      // Reset button (running-state primary CTA) prompts
      fireEvent.click(screen.getByText(/reset/i));
      expect(screen.getByText(/closing this page will reset/i)).toBeTruthy();
      // Cancel returns to running
      fireEvent.click(screen.getByText(/cancel/i));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('done: close does NOT prompt', async () => {
      const onClose = vi.fn();
      render(<FocusTimer isOpen onClose={onClose} />);
      fireEvent.change(screen.getByRole('slider'), {
        target: { value: String(5 * 60) },
      });
      fireEvent.click(screen.getByText(/start/i));
      await act(async () => { vi.advanceTimersByTime(5 * 60 * 1000); });
      fireEvent.click(screen.getByText(/close/i));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE_VITEST.
- **IMPORTS**: as shown.
- **GOTCHA**: `vi.useFakeTimers()` replaces `setInterval` so the hook's tick fires only when `vi.advanceTimersByTime` runs. Wrap in `act` so React batches re-renders. The SafeOverlay stub bypasses the `useEffect` that demotes `willChange` (irrelevant in jsdom).
- **VALIDATE**: `pnpm vitest run src/components/player/FocusTimer/FocusTimer.test.tsx` — 4 tests pass.

### Task 8: Wire `isFocusTimerOpen` into App.tsx + PlayerChrome
- **ACTION**: Edit `src/App.tsx` and `src/components/layout/PlayerChrome.tsx`.
- **IMPLEMENT**:
  - In `App.tsx`:
    - Add `const [isFocusTimerOpen, setIsFocusTimerOpen] = useState(false);` next to the other three.
    - Add `const toggleFocusTimer = useCallback(() => setIsFocusTimerOpen((prev) => !prev), []);`. **Do not** auto-close the other three when opening the focus timer — the timer is independent (matches user's "user control" stance — they may want the queue or lyrics open while picking a duration). But DO close all three (including focus timer) on sidebar nav, just like the existing handler.
    - In every place that resets `setIsLyricsOpen(false); setIsQueueOpen(false); setIsNowPlayingOpen(false);` (5 sites, line numbers in Mandatory Reading), add `setIsFocusTimerOpen(false);`.
    - In the AppShell render, mount `<FocusTimer isOpen={isFocusTimerOpen} onClose={() => setIsFocusTimerOpen(false)} />` next to `<NowPlaying>`.
    - Pass the new props to `<PlayerChrome focusTimerOpen={isFocusTimerOpen} onToggleFocusTimer={toggleFocusTimer} … />`.
  - In `PlayerChrome.tsx`:
    - Add `focusTimerOpen: boolean; onToggleFocusTimer: () => void;` to the props interface.
    - Add the new ChromeButton between the existing lyrics and queue buttons (so order is: like → vol → lyrics → **focus** → queue).
- **MIRROR**: APP_OVERLAY_STATE + CHROME_BUTTON_USAGE.
- **IMPORTS**: `import { FocusTimer } from './components/player/FocusTimer';` in App.tsx; `import { ClockIcon } from '../icons';` in PlayerChrome.tsx.
- **GOTCHA**:
  - **Sidebar nav reset**: forgetting one of the five sites where the existing three flags reset is the documented WKWebView click-stealing bug (CLAUDE.md). Add `setIsFocusTimerOpen(false)` everywhere the others reset, no exceptions.
  - **Don't let the timer overlay capture Cmd+L / shortcut bindings**. App.tsx gates `useGlobalShortcuts` on `phase === 'app'` only — the timer is mounted within that phase, so shortcuts continue to work. The overlay's `pointer-events: auto` is naturally AND-ed with `isOpen` by SafeOverlay.
  - **Z-index**: SafeOverlay defaults to 80; that's the same as NowPlaying. If both are open simultaneously, the later-mounted (focus timer) sits on top. That's fine — user picks one or the other.
- **VALIDATE**: Click the new clock button → overlay appears with the slider; clicking it again with state=idle closes immediately (no confirm); start a 5-min timer, click the clock → confirm appears.

### Task 9: Version bump + release-style validation
- **ACTION**: Bump patch in `package.json` and `src-tauri/tauri.conf.json` (1.2.1 → 1.2.2).
- **IMPLEMENT**: One-line edit in each file.
- **MIRROR**: Existing pattern; CLAUDE.md mandates patch bump per code-bearing commit.
- **IMPORTS**: N/A.
- **GOTCHA**: Both files MUST stay in sync — Tauri's auto-update channel reads `tauri.conf.json`; the npm scripts (`pnpm tauri dev`'s outer harness) read `package.json`.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run && (cd src-tauri && cargo check && cargo test --lib)` — full suite green.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Hook: `setDuration` while idle updates `totalSecs` and `remainingSecs` | `setDuration(10*60)` while idle | both equal 600 | — |
| Hook: `setDuration` while running is a no-op | `setDuration(10*60)` while running | unchanged | ✓ ignore late slider changes |
| Hook: `start` only transitions from idle | `start()` while running | no state change | ✓ |
| Hook: tick decrements remaining each second | `vi.advanceTimersByTime(3000)` | `remainingSecs -= 3` | — |
| Hook: tick to 0 fires `onComplete` exactly once | run for full duration | `onComplete` called 1× | ✓ no double-fire |
| Hook: tick to 0 transitions state to 'done' | as above | state === 'done' | — |
| Hook: `reset` after running returns to 'idle' with `totalSecs` preserved | run + `reset()` | state === 'idle', remaining === totalSecs | — |
| Component: notification fires with the exact title/body strings | run timer to 0 | `notificationApi.show('Focus session complete', 'You made it, time to take a break.')` | regression guard for the user-visible string |
| Component: close attempt while running shows confirmation | click close on running | modal renders | ✓ |
| Component: close attempt while idle does NOT show confirmation | click close on idle | modal absent, onClose called | ✓ |
| Component: close attempt while done does NOT show confirmation | click close on done | modal absent, onClose called | ✓ |
| Component: confirm-and-exit calls reset then onClose | click close → confirm | onClose called once, slider back to default | ✓ |

### Edge Cases Checklist
- [x] Slider at min (5:00) — Start works; ticks to 0
- [x] Slider at max (120:00) — `remainingSecs` and `totalSecs` both 7200; UI doesn't overflow (test with `m` going to 3 digits — `String(120).padStart(2, '0')` → `"120"` is fine)
- [x] StrictMode dev double-mount — `useEffect`-on-close reset uses `Promise.resolve().then` to defer until after the second mount, identical to the LoginPage `mountedRef` fix shipped in this PR's predecessor
- [x] App quit while running — no persistence, next launch starts at idle/default (verified by NOT writing to `state::persistence` and NOT subscribing to any `App::on_run_event` for the focus timer)
- [x] Notification permission revoked at OS level — `notificationApi.show` rejects, the `.catch(() => {})` on the call site swallows it, the "Done" overlay is the visual confirmation
- [x] Sidebar nav while running — `setIsFocusTimerOpen(false)` resets the overlay; the next open is fresh (per user: any close path resets). Note: this happens **without confirmation** because the sidebar nav triggers `setIsFocusTimerOpen(false)` directly, bypassing the overlay's `tryClose`. Per user: "anything in the page can lead to the timer page be closed should pop up the confirmation window" — to honour this strictly, the sidebar nav handler must instead **call `tryClose` via a ref** OR show the modal at the App level. **Decision**: hoist the confirmation gate into `App.tsx`'s sidebar-nav handler — checks an exposed `focusTimerState` ref; if `running`, prompts; only completes the navigation on confirm. See Task 8 GOTCHA addendum below.
- [ ] **Cmd+W / Cmd+Q while running**: Cmd+W triggers Tauri's window-close event; Cmd+Q quits the app. Per user: "the timer should reset if the app is closed" → these paths bypass the confirmation. That's consistent with native macOS behaviour (apps don't intercept Cmd+Q for game state). **Document this behaviour** in the focus-timer copy as "Closing the app resets your session" — but don't intercept the OS event. Out of scope.

### Edge case follow-up (App-level confirmation gate)
The user explicitly said "**anything in the page** can lead to the timer page be closed should pop up the confirmation window". To honour this for sidebar nav, I'll add an extra wrinkle to Task 8:
- Expose `focusTimerState` from the hook, lift the modal state to `App.tsx`, and have the sidebar `onNavigate` callback (and any other in-app close path) check `focusTimerState === 'running'` before closing the overlay. If running, show the modal; on cancel, abort the navigation; on confirm, perform the navigation.
- The simplest implementation: pull the hook usage up to `App.tsx`, pass `state` + `reset` down to `<FocusTimer>` as props. This is a cleaner separation anyway (Pattern: lifting state for cross-component coordination — see how `App.tsx` already owns `isQueueOpen`).
- I'll bake this into Task 8's IMPLEMENT block; the hook stays unchanged.

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
```
EXPECT: zero TypeScript errors.

```bash
cd src-tauri && cargo check
```
EXPECT: zero Rust errors (existing dead-code warnings only).

### Unit Tests
```bash
pnpm vitest run src/components/player/FocusTimer/
```
EXPECT: all FocusTimer tests pass (≥10 tests across hook + component).

```bash
cd src-tauri && cargo test --lib
```
EXPECT: 207+ tests pass (no Rust unit test added; the new command is a thin proxy and the notification plugin is itself well-tested upstream).

### Full Test Suite
```bash
pnpm vitest run
```
EXPECT: full suite green (29+ files, 245+ tests).

### Browser Validation
```bash
pkill -f "tauri dev" 2>/dev/null; pkill -f "VibeYTM" 2>/dev/null; sleep 1; pnpm tauri dev
```
EXPECT:
1. New clock button appears between lyrics and queue in the player chrome.
2. Clicking the clock opens a centred card on a heavy-blur backdrop, identical look-and-feel to NowPlaying.
3. Slider defaults to 25:00; dragging updates the readout in real time.
4. Start → readout counts down at 1Hz; primary button changes to "Reset"; close button still visible top-right.
5. Click Reset (or the close button) → confirmation modal appears.
6. Cancel → returns to running.
7. Confirm → overlay closes, next open is back to idle/default.
8. Let timer run to 0 → macOS notification fires ("You made it, time to take a break."); overlay shows "Done"; close button does NOT prompt.
9. While running, click a sidebar item → confirmation modal blocks navigation; cancel returns to running; confirm completes the navigation.
10. Quit Cmd+Q while running → restart → app opens at Home, timer state is gone (no persistence by design).
11. Settings → "Sign in to YouTube Music" → YTM aux window navigates to `accounts.google.com/ServiceLogin?...` and becomes visible (Task 0 verification).

### Manual Validation
- [ ] Visual diff: focus-timer card shadows / typography / button shapes match NowPlaying card
- [ ] Notification fires from a `release` build (sometimes dev builds skip notification permission for unsigned binaries — verify with `pnpm tauri build`)
- [ ] Keyboard accessibility: focus reaches Start, slider, close button via Tab; Enter activates buttons
- [ ] aria-label coverage on the clock chrome button (`Show focus timer` / `Hide focus timer`) matches the queue button's pattern

---

## Acceptance Criteria
- [ ] Clock button visible between lyrics and queue in chrome
- [ ] Slider 5–120 min, 5-min steps, default 25
- [ ] Music transport never auto-affected
- [ ] Notification fires once at countdown == 0 with the exact strings the user specified ("You made it, time to take a break.")
- [ ] "Done" overlay state requires no confirmation to dismiss
- [ ] Confirmation modal appears for any close path while `state === 'running'` (close button, reset button, sidebar nav, NowPlaying open, etc.)
- [ ] State resets fully on every overlay close + every app launch
- [ ] No new TypeScript or Rust warnings beyond pre-existing
- [ ] All tests written and passing (`pnpm vitest run` + `cargo test --lib`)
- [ ] Settings sign-in button now goes directly to Google sign-in URL
- [ ] Patch version bumped (1.2.1 → 1.2.2)

## Completion Checklist
- [ ] Code follows discovered patterns (CHROME_BUTTON_USAGE, SAFE_OVERLAY_FULLSCREEN, APP_OVERLAY_STATE)
- [ ] Error handling matches codebase style (Tauri commands return `Result<_, String>`; frontend swallows non-fatal IPC failures)
- [ ] Logging via `tracing::warn!` on the Rust notification path; no console.log in production frontend code
- [ ] No hardcoded values inline — `MIN_SECS` / `MAX_SECS` / `STEP_SECS` / `DEFAULT_SECS` named constants
- [ ] Comments stick to non-obvious WHY (notification permission origin, StrictMode reset deferral, etc.) — not narration
- [ ] Self-contained — implementer needs no further codebase searching

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Notification permission revoked at the OS level | Low | Notification doesn't fire; "Done" overlay is the only feedback | Document in copy ("If you don't see a notification, check System Settings → Notifications → VibeYTM"). Out-of-scope to surface in UI for v1. |
| Hoisting hook into App.tsx surfaces a bug in App.tsx's existing prop wiring | Medium | A re-render on every tick of the timer (App.tsx is the parent of *everything*) | Wrap timer state in a `useMemo` boundary OR push the `<FocusTimer>` into a child component that owns the hook locally with a callback ref to expose `state` upward — second option is cleaner. Plan defaults to second; if implementer prefers, the first is acceptable. |
| `vi.useFakeTimers` interacts oddly with React 19's `useEffect` cleanup ordering | Low | Test flakes on the "tick to 0" assertion | Wrap `advanceTimersByTime` in `act(async)`; if needed, add a single `await Promise.resolve()` after to flush microtasks |
| User finds 5-min minimum too long for a quick verification of the feature | Low | UX friction, not a bug | The vitest covers the 5-min boundary directly; for manual testing, the implementer can temporarily set `MIN_SECS = 5` (5 seconds) — but **MUST revert before committing**. |

## Notes
- **Why not pause/resume**: explicitly forbidden by user. Don't add a Pause button "just because" — it'll create a 4-state machine and the user wants 3.
- **Why one notification, not a sound**: user said "system notification only". macOS notifications already include a system tone by default — that's the sound. We don't override.
- **Why the Settings fix is in this PR**: the user added it as an addendum to the focus-timer ask. Both touch user-visible chrome behaviour and are small enough to bundle. If the maintainer prefers separate PRs, the Settings fix is one self-contained line in `SettingsPage.tsx:364`.
- **Why keep the confirmation modal in-component (not native `confirm()`)**: Tauri's WKWebView renders native dialogs inconsistently (no styling control, sometimes bypassed by drag region). Inline modal also matches the project's design system (LiquidGlass card, accent CTA).
- **Per CLAUDE.md "Conflict Detection"**: This change does NOT conflict with any documented invariant. It adds a new overlay flag but resets it through the same sidebar-nav handler that already resets the existing three. Banned `transform: scale` is honoured.
- **Per CLAUDE.md "Search GitHub before implementing"**: focus-timer overlays are a generic UI pattern — no specific reference implementation cited. The kaset reference used for the login flow doesn't have a focus timer. Inline implementation against `SafeOverlay` is appropriate scope.
- **Per CLAUDE.md "Visual fidelity to external products"**: the user said "mirror the playing page", not "match Apple Music's focus mode". Mirroring means reusing `NowPlaying`'s `SafeOverlay` props and typographic tokens — no external screenshot fetch needed.
