# Plan: Direct-to-Google sign-in for the LoginPage

## Summary
When a signed-out user lands on the `LoginPage`, navigate the YTM webview directly to Google's account-chooser sign-in URL (with `continue=https://music.youtube.com/`) instead of dropping them on the music.youtube.com home page where they have to hunt for the "Sign in" anchor. The YTM home page still loads first for signed-in users (so we don't regress issue #51 — no-flash-on-launch), but the *visible* state on the LoginPage skips one click and lands on Google's identity picker.

## User Story
As a first-time / signed-out VibeYTM user, I want the auxiliary YTM window to open straight on Google's sign-in screen, so that I can authenticate without first scanning music.youtube.com for the sign-in button.

## Problem → Solution
**Current**: `LoginPage` calls `ytmApi.showYtm()` → the YTM window (already pointed at `https://music.youtube.com`) becomes visible. The user must locate and click the "Sign in" link in the nav bar to reach Google's auth flow. ~2 extra clicks and ~3 seconds of confusion.

**Desired**: `LoginPage` navigates the YTM window to Google's sign-in URL with `continue=https://music.youtube.com/` and *then* shows it. The user immediately sees the Google account chooser. After they pick / authenticate, Google redirects back to music.youtube.com, the bridge re-evaluates the avatar selector, `__VIBEYTM_LOGGED_IN__` flips to `true`, the poller emits `player:login-changed: true`, and `LoginPage.autoAdvance()` hides the window and moves to the app — exactly the existing handoff path.

## Metadata
- **Complexity**: Small
- **Source PRD**: N/A
- **PRD Phase**: N/A (free-form ask)
- **Estimated Files**: 4 changed, 0 new

---

## UX Design

### Before
```
┌─ VibeYTM main window ──────────────┐    ┌─ YTM window (after Show YTM) ────┐
│  Welcome to VibeYTM                │    │  music.youtube.com home          │
│  A YTM window should have opened…  │    │  ┌─────────────────────────────┐ │
│  [I'm signed in]  [Show YTM] [Skip]│    │  │ Search • Home • Explore   ⓘ │ │
└────────────────────────────────────┘    │  │   …shelves…                 │ │
                                          │  │   user must find "Sign in"  │ │
                                          │  └─────────────────────────────┘ │
                                          └──────────────────────────────────┘
```

### After
```
┌─ VibeYTM main window ──────────────┐    ┌─ YTM window (after Show YTM) ────┐
│  Welcome to VibeYTM                │    │  accounts.google.com/v3/signin   │
│  Sign in with your Google account  │    │  ┌─────────────────────────────┐ │
│  in the window that just opened.   │    │  │  Choose an account          │ │
│  [I'm signed in]  [Open sign-in]   │    │  │   ◯ alice@gmail.com         │ │
│                       [Skip]       │    │  │   ◯ Use another account     │ │
└────────────────────────────────────┘    │  └─────────────────────────────┘ │
                                          └──────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| LoginPage mount | `showYtm()` only | `openSignIn()` then `showYtm()` | New IPC navigates the existing window |
| "Show YouTube Music window" button | shows current YTM home | "Open sign-in page" — re-navigates to Google | Renamed; idempotent re-trigger |
| LoginPage copy | "A YTM window should have opened… Sign in with your Google account *there*" | "Sign in with your Google account in the window that just opened." | Aligned to the new direct-to-Google flow |
| Post-sign-in handoff | `player:login-changed` → `autoAdvance` | unchanged | Existing event path keeps working |
| Already-signed-in launch | YTM window stays hidden, user lands in app | unchanged | Window is still pointed at music.youtube.com on creation; no regression of #51 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/components/pages/LoginPage.tsx` | 1-190 | The component being changed; contains current `showYtm`/`injectBridge` flow + autoAdvance latch |
| P0 | `src-tauri/src/webview_bridge/mod.rs` | 1-150 | Pattern for window helpers (`hide_ytm_window`, `show_ytm_window`, `navigate_to_track`); injection-safe URL handling |
| P0 | `src-tauri/src/commands/player.rs` | 468-493 | Pattern for thin Tauri commands that proxy `webview_bridge::*` helpers (`hide_ytm`, `show_ytm`, `inject_ytm_bridge`) |
| P0 | `src-tauri/src/lib.rs` | 350-415, 495-525 | Where commands are registered (`invoke_handler!`) and where the `ytm` window is created with the Safari UA (auth-critical) |
| P1 | `src/lib/ipc.ts` | 162-200 | `playerApi` and `ytmApi` shape — where the new IPC wrapper goes |
| P1 | `src/hooks/useLoginState.ts` | 1-37 | Tri-state login signal; the `false` branch is what triggers `LoginPage` mount |
| P1 | `src/hooks/useBootState.ts` | 1-85 | Boot phase contract — `phase === 'login'` mounts the LoginPage; this is unchanged |
| P1 | `scripts/inject/ytm-player-bridge.js` | 790-822 | `checkLoginStatus` selector that flips `__VIBEYTM_LOGGED_IN__` based on nav-bar avatar / sign-in anchor — confirms what URL we need to come back to so the bridge re-detects |
| P2 | `src/App.tsx` | 230-252 | How `phase === 'login'` is rendered (LoginPage + WelcomeScreen overlay) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Google account-chooser URL for YouTube | YTM nav bar's actual "Sign in" anchor (verifiable via Chrome DevTools MCP on music.youtube.com) | The href YTM itself uses is the canonical entrypoint; pattern: `https://accounts.google.com/ServiceLogin?service=youtube&continue=<encoded-music-youtube-url>` (older path) or `https://accounts.google.com/v3/signin/identifier?continue=<…>&service=youtube` (current). Either works — Google redirects between them. **Mirror what the YTM "Sign in" link actually emits, captured at design time, rather than hand-rolling a URL.** |
| Safari user agent requirement | `src-tauri/src/lib.rs:498-501` (existing in-tree comment) | Google sign-in REJECTS Chrome-spoofed WebViews and refuses to render the password form. The `ytm` window is already on a Safari UA — that's why direct navigation to `accounts.google.com` will work in this project specifically. **Do NOT add a separate window for sign-in** — re-use the existing `ytm` window so the UA is correct and so the post-auth redirect lands the bridge on the same window we're already polling. |
| Tauri `WebviewWindow::eval` for SPA-friendly navigation | Existing `navigate_to_track` in `webview_bridge/mod.rs:83-103` uses `document.createElement('a').click()` to play nicely with the polymer router. The sign-in URL is a hard cross-origin transition (music.youtube.com → accounts.google.com), so a plain `window.location.assign` is correct here — polymer is not involved. |

---

## Patterns to Mirror

### TAURI_COMMAND_THIN_PROXY
```rust
// SOURCE: src-tauri/src/commands/player.rs:471-485
/// Hide the YTM window after login
#[tauri::command]
pub async fn hide_ytm(app: AppHandle) -> Result<(), String> {
    let window = crate::webview_bridge::get_ytm_window(&app)
        .ok_or("YTM window not found")?;
    crate::webview_bridge::hide_ytm_window(&window)
}

/// Show the YTM window (for re-login or debugging)
#[tauri::command]
pub async fn show_ytm(app: AppHandle) -> Result<(), String> {
    let window = crate::webview_bridge::get_ytm_window(&app)
        .ok_or("YTM window not found")?;
    crate::webview_bridge::show_ytm_window(&window)
}
```
Mirror exactly: `pub async fn navigate_ytm_to_login(app: AppHandle) -> Result<(), String>` that resolves the `ytm` window then delegates to a `webview_bridge::navigate_to_login(&window)` helper.

### WEBVIEW_BRIDGE_HELPER
```rust
// SOURCE: src-tauri/src/webview_bridge/mod.rs:46-50
pub fn show_ytm_window(window: &WebviewWindow) -> Result<(), String> {
    tracing::info!("showing YTM window");
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
```
The new helper mirrors this shape: `pub fn navigate_to_login(window: &WebviewWindow) -> Result<(), String>` — log via `tracing::info!`, return `Result<_, String>` (matches the rest of `webview_bridge` for IPC compatibility).

### URL_INJECTION_SAFETY
```rust
// SOURCE: src-tauri/src/webview_bridge/mod.rs:19-30
fn validate_ytm_id(id: &str, max_len: usize, field: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > max_len { return Err(...); }
    if !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err(...);
    }
    Ok(())
}
```
**The login URL is a hardcoded constant — no caller-supplied data is interpolated**, so we don't need to mirror this validator. The constant lives at the top of `webview_bridge/mod.rs` next to the helpers. Treating the URL as a `const` (not a runtime arg) makes the JS-eval injection vector inert by construction.

### IPC_CLIENT_WRAPPER
```ts
// SOURCE: src/lib/ipc.ts:196-200
export const ytmApi = {
  hideYtm: () => invoke('hide_ytm'),
  showYtm: () => invoke('show_ytm'),
  injectBridge: () => invoke('inject_ytm_bridge'),
};
```
Add `openSignIn: () => invoke('navigate_ytm_to_login')` in the same object. camelCase wrapper, snake_case Rust command — matches the existing convention.

### LOGINPAGE_HANDOFF_LATCH
```tsx
// SOURCE: src/components/pages/LoginPage.tsx:14-23
const handedOffRef = useRef(false);
const autoAdvance = () => {
  if (handedOffRef.current) return;
  handedOffRef.current = true;
  ytmApi.hideYtm().catch(() => {});
  onLoggedIn();
};

useTauriEvent<boolean>('player:login-changed', (isLoggedIn) => {
  if (isLoggedIn) autoAdvance();
});
```
Do **not** change this. The post-auth handoff stays untouched — the new code only changes what the user sees *before* signing in.

### COMPONENT_INIT_EFFECT
```tsx
// SOURCE: src/components/pages/LoginPage.tsx:32-42
useEffect(() => {
  ytmApi.showYtm().catch(() => {});
  ytmApi.injectBridge().catch(() => {});
}, []);
```
Replace with: navigate to login URL → then `showYtm()` → then `injectBridge()`. Order matters: navigating first gives Google a beat to start loading; showing second avoids a visible music.youtube.com flash before Google takes over; injecting last so the bridge is in place when the post-auth redirect lands back on music.youtube.com (the bridge's `initialization_script` registration on the window survives navigation, but explicit re-injection is the existing belt-and-suspenders pattern).

### TEST_STRUCTURE_RUST
```rust
// SOURCE: src-tauri/src/webview_bridge/mod.rs:218-260 (existing tests block)
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigate_to_track_appends_song_radio_list() { … }
}
```
Add a unit test that asserts the constant URL string contains the expected `service=youtube` parameter and a properly URL-encoded `continue=` pointing at `https://music.youtube.com/`. Pure-string assertion — no Tauri runtime needed.

### TEST_STRUCTURE_VITEST
```ts
// SOURCE: src/components/layout/Sidebar.test.tsx (existing pattern)
vi.mock('../../hooks/useLoginState', () => ({ useLoginState: () => true }));
```
For LoginPage tests: mock `ytmApi` and assert that `openSignIn` is called once on mount, before `showYtm`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src-tauri/src/webview_bridge/mod.rs` | UPDATE | Add `GOOGLE_SIGNIN_URL` const + `navigate_to_login` helper next to `show_ytm_window`. Add unit test. |
| `src-tauri/src/commands/player.rs` | UPDATE | Add thin `navigate_ytm_to_login` Tauri command mirroring `show_ytm` |
| `src-tauri/src/lib.rs` | UPDATE | Register `commands::player::navigate_ytm_to_login` in the `invoke_handler!` macro |
| `src/lib/ipc.ts` | UPDATE | Add `openSignIn` wrapper to `ytmApi` |
| `src/components/pages/LoginPage.tsx` | UPDATE | Change `useEffect` to `openSignIn` → `showYtm` → `injectBridge`; rename "Show YTM window" button to "Open sign-in page" and have it call `openSignIn` again; refresh paragraph copy |
| `src/components/pages/LoginPage.test.tsx` (CREATE if absent) | CREATE | Vitest covering: mount calls `openSignIn` then `showYtm`; "Open sign-in page" button re-calls `openSignIn`; `player:login-changed:true` triggers `onLoggedIn`. |

## NOT Building

- A second WebView/window dedicated to sign-in. Re-use `ytm` so the Safari UA (required by Google) already applies and so the post-auth redirect lands on the same window the bridge is polling.
- Headless / cookie-injection sign-in. We're not bypassing Google's UI, only routing to it directly.
- A change to launch-time URL of the `ytm` window. The window must still load `music.youtube.com` initially so already-signed-in users skip both `LoginPage` and any extra navigation hop. Issue #51's no-flash invariant stays.
- Detecting when the user has reached `accounts.google.com` and reflecting it in `LoginPage` copy. The existing copy + autoAdvance is enough.
- Handling the "Skip for now" branch differently. Same behavior — `markManualLogin` → app shell.
- Touching `useLoginState` / `useBootState`. The signal contract is unchanged.
- A new Tauri capability / permission — `webview_bridge` already has `eval` rights for the `ytm` window via the existing helpers.

---

## Step-by-Step Tasks

### Task 1: Add `GOOGLE_SIGNIN_URL` constant + `navigate_to_login` helper in `webview_bridge`
- **ACTION**: Add a `const GOOGLE_SIGNIN_URL: &str = "...";` near the top of `src-tauri/src/webview_bridge/mod.rs` and a public helper `pub fn navigate_to_login(window: &WebviewWindow) -> Result<(), String>` that uses `window.eval(&js)` with `window.location.assign(<URL>)`.
- **IMPLEMENT**:
  ```rust
  // The URL Google's account-chooser uses for "sign in to YouTube" — verified
  // against the actual `<a href>` rendered on music.youtube.com's nav bar
  // (see scripts/inject/ytm-player-bridge.js:801 — the bridge looks for
  // anchors whose href contains `accounts.google.com`).
  // `service=youtube` is what makes Google's flow short-circuit to the
  // YouTube/YTM-branded sign-in screen instead of generic Gmail.
  // `continue=` MUST be URL-encoded music.youtube.com so post-auth lands
  // back where the bridge can re-detect __VIBEYTM_LOGGED_IN__.
  // URL chain mirrored from kaset (sozercan/kaset, LoginWebView.swift) —
  // routes through youtube.com/signin?action_handle_signin=true&app=desktop
  // before landing on music.youtube.com so YT treats the WebKit session as
  // a real desktop sign-in and persists cookies across YT/YTM domains.
  const GOOGLE_SIGNIN_URL: &str = "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Den%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F";

  /// Navigate the YTM window directly to Google's sign-in screen.
  /// Used when the LoginPage is up so the user doesn't have to find the
  /// "Sign in" anchor inside music.youtube.com's nav bar themselves.
  pub fn navigate_to_login(window: &WebviewWindow) -> Result<(), String> {
      tracing::info!(url = GOOGLE_SIGNIN_URL, "navigate_to_login");
      // Cross-origin SPA-bypassing navigation. NOT navigate_to_track's
      // `<a>.click()` trick — polymer router isn't involved here, and we
      // explicitly want a full top-level navigation away from the YTM SPA.
      let js = format!("window.location.assign({});", serde_json::to_string(GOOGLE_SIGNIN_URL).expect("static URL serializes"));
      window.eval(&js).map_err(|e| e.to_string())
  }
  ```
- **MIRROR**: WEBVIEW_BRIDGE_HELPER (`show_ytm_window` shape), URL_INJECTION_SAFETY (use a `const`, no caller input).
- **IMPORTS**: Already in scope (`tauri::WebviewWindow`, `tracing`). Add `use serde_json;` at top of file if not already there (the codebase uses `serde_json` heavily — `cargo check` will tell us if a top-level `use` is needed in this module specifically).
- **GOTCHA**: Do NOT format the URL into the JS source as a raw string — use `serde_json::to_string` so the URL is correctly JS-string-escaped (defense-in-depth even though it's a constant; preserves the codebase's anti-injection posture documented in `validate_ytm_id`'s context). Do NOT use `WebviewWindow::navigate(...)` even though it exists — the existing helpers all use `eval` and we want consistency for the poller, which uses `__VIBEYTM_DEBUG__` log lines that depend on `eval`-routed timing.
- **VALIDATE**: `cd src-tauri && cargo check` — zero errors. New unit test (Task 6) compiles.

### Task 2: Add `navigate_ytm_to_login` Tauri command
- **ACTION**: Append to `src-tauri/src/commands/player.rs`, immediately after `inject_ytm_bridge` (line ~493).
- **IMPLEMENT**:
  ```rust
  /// Navigate the YTM window directly to Google's sign-in URL.
  /// Called by the LoginPage on mount so the user lands on the account
  /// chooser instead of music.youtube.com's home page.
  #[tauri::command]
  pub async fn navigate_ytm_to_login(app: AppHandle) -> Result<(), String> {
      let window = crate::webview_bridge::get_ytm_window(&app)
          .ok_or("YTM window not found")?;
      crate::webview_bridge::navigate_to_login(&window)
  }
  ```
- **MIRROR**: TAURI_COMMAND_THIN_PROXY (line 481-485 — `show_ytm`).
- **IMPORTS**: None new — `AppHandle` already imported in this file.
- **GOTCHA**: Keep it `pub async fn` even though the body has no `.await` — `#[tauri::command]` async commands run on the async runtime and a sync command in this position would inconsistently surface from the invoke layer. Match `show_ytm`'s signature exactly.
- **VALIDATE**: `cargo check` passes.

### Task 3: Register the new command in `lib.rs`'s `invoke_handler!`
- **ACTION**: Edit `src-tauri/src/lib.rs` line ~379 — add `commands::player::navigate_ytm_to_login,` directly under `commands::player::inject_ytm_bridge,` so the YTM-window-management commands stay grouped.
- **IMPLEMENT**:
  ```rust
  commands::player::hide_ytm,
  commands::player::show_ytm,
  commands::player::inject_ytm_bridge,
  commands::player::navigate_ytm_to_login,   // <-- new
  ```
- **MIRROR**: Existing alphabetical-ish grouping inside the macro is loose; group by *concern* (YTM-window controls).
- **IMPORTS**: None — `commands::player::*` already in scope.
- **GOTCHA**: A missing comma in `tauri::generate_handler!` produces a confusing macro error. Double-check the trailing comma on every line in this block after editing.
- **VALIDATE**: `cargo check` passes; `cargo build` compiles the Tauri app.

### Task 4: Surface `openSignIn` in the frontend `ytmApi`
- **ACTION**: Edit `src/lib/ipc.ts` lines 196-200.
- **IMPLEMENT**:
  ```ts
  export const ytmApi = {
    hideYtm: () => invoke('hide_ytm'),
    showYtm: () => invoke('show_ytm'),
    injectBridge: () => invoke('inject_ytm_bridge'),
    /**
     * Navigate the YTM auxiliary window directly to Google's sign-in
     * screen. Used by LoginPage so the user doesn't have to locate the
     * "Sign in" link inside music.youtube.com's nav bar.
     */
    openSignIn: () => invoke('navigate_ytm_to_login'),
  };
  ```
- **MIRROR**: IPC_CLIENT_WRAPPER (`hideYtm`/`showYtm` shape).
- **IMPORTS**: None — `invoke` already imported.
- **GOTCHA**: The Rust command name is `navigate_ytm_to_login` (snake_case); the JS wrapper is `openSignIn` (camelCase). Tauri matches by the literal string passed to `invoke`, not by camelCase conversion. **The string in `invoke('navigate_ytm_to_login')` MUST match the Rust function name byte-for-byte.**
- **VALIDATE**: `pnpm typecheck` passes; the new method is reachable from `LoginPage` without a TS error.

### Task 5: Update `LoginPage` to navigate to login + refresh copy
- **ACTION**: Edit `src/components/pages/LoginPage.tsx`.
- **IMPLEMENT**:
  - Replace the mount effect (lines 32-42):
    ```tsx
    useEffect(() => {
      // Skip the music.youtube.com home page entirely — drop the user
      // straight on Google's account chooser. The YTM window is still
      // pointed at music.youtube.com on construction, so we need an
      // explicit navigate here every time LoginPage mounts.
      ytmApi
        .openSignIn()
        .catch(() => {
          // If navigation fails (window-not-found etc.), fall back to
          // showing whatever the YTM window currently has. The user can
          // still manually click "Sign in" on music.youtube.com.
        });
      // Show the window AFTER kicking off navigation so the user doesn't
      // see a flash of music.youtube.com before Google takes over.
      ytmApi.showYtm().catch(() => {
        // Window-not-found is non-fatal — manual recovery via the button.
      });
      // Re-inject the bridge so once Google redirects back to
      // music.youtube.com __VIBEYTM_LOGGED_IN__ flips and triggers
      // autoAdvance via the player:login-changed event.
      ytmApi.injectBridge().catch(() => {
        // Already injected via Tauri init script — safe to ignore.
      });
    }, []);
    ```
  - Repurpose `handleShowYtm` (lines 44-52) into `handleOpenSignIn`:
    ```tsx
    const handleOpenSignIn = async () => {
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
  - Update the button label (line 169) from `Show YouTube Music window` to `Open sign-in page` and rename `onClick={handleShowYtm}` to `onClick={handleOpenSignIn}`.
  - Update the body copy (lines 99-101) from
    `A YouTube Music window should have opened alongside this one. Sign in with your Google account there, then come back here.`
    to
    `Sign in with your Google account in the window that just opened. We'll bring you back here automatically once you're signed in.`
- **MIRROR**: COMPONENT_INIT_EFFECT (existing structure), LOGINPAGE_HANDOFF_LATCH (do not touch the latch / `useTauriEvent` block).
- **IMPORTS**: None new — `ytmApi` already imported.
- **GOTCHA**: 
  - Do NOT remove the `injectBridge` call. After Google redirects back to `music.youtube.com`, the page is freshly loaded; while the Tauri `initialization_script` re-runs on every navigation, the explicit `injectBridge()` is a belt-and-suspenders the project deliberately ships and removing it has caused regressions in the past.
  - The order matters: `openSignIn` first (kicks off the cross-origin nav), `showYtm` second (so the user doesn't see music.youtube.com pre-redirect), `injectBridge` last (so it queues against the post-redirect-back page when sign-in completes).
  - Keep the latch (`handedOffRef`) untouched — `player:login-changed` may fire multiple times as the bridge polls, and the existing latch is what prevents double-fire of `onLoggedIn`.
  - WKWebView click-target rule (CLAUDE.md): the existing `<button>` elements are already real `<button>` tags — **do not** change them to `<div role="button">` while editing copy.
- **VALIDATE**: `pnpm typecheck` clean; manual run of `pnpm tauri dev` (signed-out account or with cookies cleared) shows the YTM window open on `accounts.google.com` directly.

### Task 6: Unit-test the URL constant
- **ACTION**: Add to the existing `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/webview_bridge/mod.rs`.
- **IMPLEMENT**:
  ```rust
  #[test]
  fn google_signin_url_targets_youtube_service_and_continues_to_music_youtube() {
      // service=youtube short-circuits Google to the YT-branded sign-in.
      // Removing this kicks the user to a generic Gmail sign-in page.
      assert!(
          GOOGLE_SIGNIN_URL.contains("service=youtube"),
          "sign-in URL must request the YouTube-branded flow: {GOOGLE_SIGNIN_URL}"
      );
      // continue= must be a URL-encoded music.youtube.com so the bridge
      // re-detects __VIBEYTM_LOGGED_IN__ on the post-auth redirect.
      assert!(
          GOOGLE_SIGNIN_URL.contains("continue=https%3A%2F%2Fmusic.youtube.com%2F"),
          "sign-in URL must redirect back to music.youtube.com: {GOOGLE_SIGNIN_URL}"
      );
      assert!(
          GOOGLE_SIGNIN_URL.starts_with("https://accounts.google.com/"),
          "sign-in URL must point at Google's auth domain: {GOOGLE_SIGNIN_URL}"
      );
  }
  ```
- **MIRROR**: TEST_STRUCTURE_RUST (the existing `navigate_to_track_appends_song_radio_list` test in the same file).
- **IMPORTS**: `use super::*;` already at top of test module.
- **GOTCHA**: Pure string assertion — no Tauri runtime involved, runs under `cargo test --lib`.
- **VALIDATE**: `cargo test --lib webview_bridge` passes; intentionally break the URL (e.g. drop `service=youtube`) and confirm the test fails.

### Task 7: Vitest for `LoginPage` mount + button
- **ACTION**: Create `src/components/pages/LoginPage.test.tsx` (or update an existing test file if present — confirmed none today).
- **IMPLEMENT**:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen, fireEvent, act } from '@testing-library/react';
  import { LoginPage } from './LoginPage';

  const ytmApi = {
    hideYtm: vi.fn().mockResolvedValue(undefined),
    showYtm: vi.fn().mockResolvedValue(undefined),
    injectBridge: vi.fn().mockResolvedValue(undefined),
    openSignIn: vi.fn().mockResolvedValue(undefined),
  };
  vi.mock('../../lib/ipc', () => ({ ytmApi }));
  vi.mock('../../hooks/useTauriEvent', () => ({
    useTauriEvent: () => {},
  }));

  describe('LoginPage', () => {
    beforeEach(() => {
      Object.values(ytmApi).forEach((fn) => fn.mockClear());
    });

    it('navigates to the sign-in page on mount before showing the YTM window', async () => {
      await act(async () => {
        render(<LoginPage onLoggedIn={() => {}} />);
      });
      expect(ytmApi.openSignIn).toHaveBeenCalledTimes(1);
      expect(ytmApi.showYtm).toHaveBeenCalledTimes(1);
      // openSignIn must run before showYtm so the user never sees a
      // music.youtube.com flash before Google takes over.
      const openOrder = ytmApi.openSignIn.mock.invocationCallOrder[0];
      const showOrder = ytmApi.showYtm.mock.invocationCallOrder[0];
      expect(openOrder).toBeLessThan(showOrder);
    });

    it('"Open sign-in page" button re-triggers the navigation', async () => {
      await act(async () => {
        render(<LoginPage onLoggedIn={() => {}} />);
      });
      ytmApi.openSignIn.mockClear();
      ytmApi.showYtm.mockClear();
      fireEvent.click(screen.getByText(/Open sign-in page/i));
      // Async handler — flush microtasks
      await act(async () => {});
      expect(ytmApi.openSignIn).toHaveBeenCalledTimes(1);
      expect(ytmApi.showYtm).toHaveBeenCalledTimes(1);
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE_VITEST + the `vi.mock` pattern from `Sidebar.test.tsx`.
- **IMPORTS**: vitest, @testing-library/react — already used in this codebase (verify with `grep -l '@testing-library/react' src/**/*.test.tsx`).
- **GOTCHA**: 
  - Mock `useTauriEvent` to a no-op so the test doesn't try to subscribe to a Tauri event bus that doesn't exist in jsdom.
  - The mount effect is async; wrap `render` in `act(async () => {…})` so the mocked promises flush.
  - **Don't** assert `injectBridge` order — it's fire-and-forget after the other two; the test doesn't care, only `openSignIn → showYtm` is the user-visible ordering.
- **VALIDATE**: `pnpm test src/components/pages/LoginPage.test.tsx` passes.

### Task 8: Manual verification with the running app
- **ACTION**: Per `CLAUDE.md` Dev Workflow, restart the dev server because `src-tauri/` Rust changed:
  ```bash
  pkill -f "tauri dev" 2>/dev/null; pkill -f "VibeYTM" 2>/dev/null; sleep 1; pnpm tauri dev
  ```
  Then verify with the user's actual signed-out state. If the user is currently signed in, sign out from the YTM window first (Account menu → Sign out), then close and re-launch VibeYTM.
- **IMPLEMENT**: Watch the dev-server task output for `navigate_to_login` log line. Confirm: (a) main window shows LoginPage, (b) auxiliary YTM window opens directly on `accounts.google.com`, (c) after picking an account, the YTM window automatically navigates back to music.youtube.com, (d) `player:login-changed: true` fires, (e) main window auto-advances to Home.
- **MIRROR**: CLAUDE.md "Verification Discipline" — verify yourself, don't ask the user to debug.
- **IMPORTS**: N/A.
- **GOTCHA**: 
  - Some users (specifically: Apple-Music-style users with multiple Google accounts) have a saved "remember me" cookie that auto-redirects through `accounts.google.com/AccountChooser` back to music.youtube.com signed in. That's fine — the bridge then immediately reports signed-in and `autoAdvance` runs without showing the picker. This is desirable behavior, not a bug.
  - **DO NOT regress issue #51** (no flash on launch for already-signed-in users). Verify by signing in fully, quitting VibeYTM, restarting — the YTM window should NEVER become visible because we never reach LoginPage. The `ytm` window is still constructed pointed at `music.youtube.com` and stays hidden. Confirm by running `pnpm tauri dev` while signed in and watching that the `navigate_to_login` log line is NOT printed.
  - Test the "I'm signed in — let's go" button still works (manual override path).
- **VALIDATE**: All five steps above pass on a real run, plus the no-flash-on-launch invariant for signed-in users.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `google_signin_url_targets_youtube_service_and_continues_to_music_youtube` | `GOOGLE_SIGNIN_URL` constant | Contains `service=youtube`, URL-encoded music.youtube.com `continue=`, `accounts.google.com` host | ✓ regression guard against future URL edits |
| `LoginPage > navigates to the sign-in page on mount before showing the YTM window` | Mount component | `openSignIn` called before `showYtm`, both exactly once | ✓ ordering invariant |
| `LoginPage > "Open sign-in page" button re-triggers the navigation` | Click button | `openSignIn` + `showYtm` each called again | ✓ idempotency / manual recovery |

### Edge Cases Checklist
- [x] `openSignIn` IPC fails (window not found) — current `LoginPage` catches and silently degrades; manual button is the recovery
- [x] User is already signed in (cookies present) — Google auto-redirects through to music.youtube.com; bridge reports signed-in; `autoAdvance` runs. Visible to the user as a brief auth-flow flash; acceptable.
- [x] User picks "Skip for now" — `markManualLogin` path unchanged
- [x] User clicks "I'm signed in" before sign-in actually completes — `handleDone` calls `hideYtm` + `onLoggedIn`; if the bridge later reports signed-out, `useLoginState` will correct it via the event stream. Same behavior as before this change — not a regression.
- [x] Network failure on `accounts.google.com` — WebView shows Safari's offline page; not our problem to handle
- [ ] Concurrent re-mounts of LoginPage (rare — only happens if `phase` flips login→loading→login). React effect cleanup is a no-op here; acceptable.

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
```
EXPECT: Zero TypeScript errors.

```bash
cd src-tauri && cargo check
```
EXPECT: Zero Rust errors.

### Unit Tests
```bash
pnpm test src/components/pages/LoginPage.test.tsx
```
EXPECT: Both LoginPage tests pass.

```bash
cd src-tauri && cargo test --lib
```
EXPECT: All existing tests + the new `google_signin_url_targets_youtube_service_and_continues_to_music_youtube` pass. Note: per CLAUDE.md, do not pin a specific test count — trust the runner output.

### Full Test Suite
```bash
pnpm test
```
EXPECT: No regressions. `Sidebar.test.tsx` (which also mocks `useLoginState`) keeps passing.

```bash
cd src-tauri && cargo test
```
EXPECT: No regressions across Rust unit + integration tests.

### Browser Validation
```bash
pkill -f "tauri dev" 2>/dev/null; pkill -f "VibeYTM" 2>/dev/null; sleep 1; pnpm tauri dev
```
EXPECT: 
1. Cold launch with cookies cleared (signed-out path): main window mounts LoginPage; YTM window opens on `accounts.google.com/ServiceLogin?service=youtube&continue=…`; after sign-in, main window auto-advances to Home.
2. Cold launch while signed in: YTM window stays hidden; main window goes straight to Home; **no flash of any YTM window** (issue #51 invariant).

### Manual Validation
- [ ] Quit VibeYTM cleanly. Sign out of YTM (or clear `accounts.google.com` cookies via Safari devtools on the YTM window). Re-launch — verify the YTM window opens directly on Google sign-in, not on music.youtube.com home.
- [ ] Sign in. Verify `player:login-changed: true` fires (visible in dev-server log because the bridge logs the transition). Verify main window auto-advances to Home and YTM window hides.
- [ ] Quit and re-launch while still signed in. Verify the YTM window NEVER becomes visible (issue #51).
- [ ] On the LoginPage, click "Open sign-in page". Verify the YTM window re-navigates to Google sign-in even if it had drifted away.
- [ ] On the LoginPage, click "Skip for now". Verify the app shell mounts (manual override path still works).

---

## Acceptance Criteria
- [ ] Signed-out users land on Google's account chooser without seeing music.youtube.com first.
- [ ] Signed-in users still bypass `LoginPage` entirely and never see the auxiliary YTM window flash (issue #51 invariant).
- [ ] Post-sign-in handoff (`player:login-changed: true` → `autoAdvance` → app) works unchanged.
- [ ] All validation commands pass.
- [ ] No new TypeScript or Rust warnings.
- [ ] Tests written and passing.
- [ ] Existing `Sidebar.test.tsx` and other login-state tests are unaffected.

## Completion Checklist
- [ ] Code follows discovered patterns (TAURI_COMMAND_THIN_PROXY, WEBVIEW_BRIDGE_HELPER, IPC_CLIENT_WRAPPER)
- [ ] Error handling matches codebase style — Tauri commands return `Result<_, String>`, frontend wrappers `.catch(() => {})` for non-fatal IPCs (matches existing LoginPage style)
- [ ] Logging via `tracing::info!` in Rust helpers
- [ ] No hardcoded values inline — `GOOGLE_SIGNIN_URL` is a named `const`
- [ ] No backwards-compatibility shims; `Show YouTube Music window` button is renamed cleanly to `Open sign-in page`
- [ ] No comments referencing the current task or this PR — comments stick to non-obvious WHY (e.g. "service=youtube short-circuits…")
- [ ] Self-contained — implementer needs no further codebase searching

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Google changes the canonical sign-in URL format (e.g. retires `ServiceLogin` in favor of `v3/signin/identifier`) | Medium (over months/years) | Sign-in still works because Google currently 302-redirects between the two; in the worst case the user sees the generic sign-in page rather than the YT-branded one | Constant lives in one place; unit test asserts the contract; trivial to update. Verify the URL still works via Chrome DevTools MCP at code-review time. |
| Google rejects the Safari UA on `accounts.google.com` for some accounts (e.g. Workspace tenants with stricter security) | Low | User can't sign in; falls back to manual reset of cookies / using the existing "I'm signed in" branch after using a real browser | Ship; document the workaround in release notes if reports come in. The current flow (loading music.youtube.com first, then clicking sign-in) suffers the *same* issue, so this is not a regression. |
| The `eval`-based navigation races against an in-flight YTM page load and Google receives the navigation before the page is settled | Low | First-load may briefly show music.youtube.com before redirecting | Acceptable — sub-second flash. If it becomes annoying, switch to passing the login URL as the *initial* `WebviewUrl::External(...)` for the `ytm` window when constructed AND only when seeded login state is `false`. That's a larger refactor and out of scope here. |
| Tauri `eval` JS string escaping bug on the URL (URL contains `&`, `:`, `/`) | Very low | Sign-in URL fails to navigate | Mitigated by using `serde_json::to_string` on the URL string before interpolation, which produces a properly JS-escaped literal. |

## Notes
- The decision to **navigate the existing `ytm` window** (rather than spawning a separate sign-in window) is load-bearing: the `ytm` window already has the Safari user-agent, the `__VIBEYTM_*` injection scripts, and the bridge poller wired up. Spawning a second window for sign-in would either need to duplicate all of that machinery or hand off cookies — both expensive and fragile compared to a one-line URL change.
- We deliberately keep the launch-time URL of the `ytm` window as `https://music.youtube.com`. Switching it to the sign-in URL unconditionally would either (a) re-trigger sign-in for already-signed-in users (bad) or (b) require seeding the login state from disk before window construction (a larger refactor; out of scope).
- The new code does not attempt to detect sign-in completion via URL — it leans on the existing `__VIBEYTM_LOGGED_IN__` mechanism (`scripts/inject/ytm-player-bridge.js:796-822`) which polls the YTM nav bar's avatar selector after the post-auth redirect. That contract is unchanged and is what makes the post-sign-in handoff work without modification.
- Per CLAUDE.md "Search GitHub before implementing": this exact pattern (route an Electron/Tauri music wrapper directly to Google sign-in instead of music.youtube.com home) is used by `th-ch/youtube-music` and other YTM desktop wrappers. The `service=youtube` + `continue=` URL shape is the canonical YouTube auth URL across all of them — we're mirroring proven prior art, not inventing a URL.
- Per CLAUDE.md "Conflict Detection": this change does NOT conflict with any documented invariant. Issue #51 (no flash on launch for signed-in users) is preserved because we only navigate when `LoginPage` mounts, which only happens for signed-out users. The bridge's `__VIBEYTM_LOGGED_IN__` selectors and SAPISID gating still work post-redirect.
