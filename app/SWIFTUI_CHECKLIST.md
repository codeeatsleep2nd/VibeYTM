# VibeYTM Swift Port — UI & Bridge Test Checklist

This checklist applies **only** to the native SwiftUI port under `app/`. It does NOT replace the React/Tauri `TEST_CHECKLIST.md` — the WKWebView-quirks rules from there apply to the *visible* React UI, which we no longer ship.

**Purpose:** prevent re-introducing bugs that were already caught and fixed. Every item below corresponds to a real defect that took multiple debug iterations to diagnose. Before declaring any UI/bridge change complete, walk this checklist and confirm each box. Patterns that "look fine" in code but trip the same bug visually have already burned us — verify visually, not just by reading.

## Layout — never let the rounded window corner clip content

The window has `.windowStyle(.hiddenTitleBar)` and a ~12 pt corner radius. Without explicit insets, every leading-edge UI element gets the leftmost few pixels eaten by that radius. Verify visually — not just by reading text — that the leftmost stroke of every glyph is fully rendered.

- [ ] **Sidebar leading inset**: outer `.safeAreaInset(edge: .leading, spacing: 0) { Color.clear.frame(width: 16) }` on `SidebarView`. `.padding(.leading)` on a `.sidebar`-styled `List` is silently absorbed — the system style overrides it. Use `safeAreaInset` for the outer container and `.listRowInsets(EdgeInsets(...))` for individual rows; nothing else takes effect.
- [ ] **Sidebar top inset**: outer `.safeAreaInset(edge: .top, spacing: 0) { Color.clear.frame(height: 32) }` so the sidebar's first row clears the traffic-light buttons. `.windowStyle(.hiddenTitleBar)` removes the system-managed inset, so this MUST be explicit.
- [ ] **Sidebar row icons must use a custom `HStack`**, not `Label(_:systemImage:)`. The stock label inside `.listStyle(.sidebar)` renders with a tight icon inset that puts the leftmost pixel of each glyph under the rounded corner. The replacement: `HStack { Image(systemName:).font(.system(size: 16)).frame(width: 24); Text(title); Spacer(minLength: 0) }.listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 8))`.
- [ ] **Column width**: `.navigationSplitViewColumnWidth(min: 240, ideal: 260, max: 340)`. Anything narrower truncates "Recently Played" once the leading inset is applied; anything wider crowds the detail pane on small screens.
- [ ] **Profile row at sidebar bottom**: 16 pt horizontal padding. 12 pt clipped the avatar circle.
- [ ] **PlayerChrome title column**: NEVER use a fixed width like `.frame(width: 280)`. At maximum sidebar width on a narrow window, that pushes the volume slider off the right edge. Use `.frame(minWidth: 180, idealWidth: 260, maxWidth: 320, alignment: .leading).layoutPriority(1)` instead.
- [ ] **Visual margin check, not just text presence**: when auditing screenshots, trace the leftmost stroke of each icon against the window's rounded corner. "Icon visible" is a binary; "icon fully rendered without clipping" is what matters.

## Sheets — must dismiss without searching for a button

- [ ] **`NowPlayingExpanded` has FIVE redundant dismissal paths and uses a CLOSURE, not `Environment(\.dismiss)`.** This sheet has been broken three times in a row. The contract is now defensive to the point of redundancy and documented as a doc-comment at the top of `NowPlayingExpanded.swift`. Every path must work independently:
  1. The caller passes an explicit `onDismiss: () -> Void` closure that flips its own presentation state. **Do not use `@Environment(\.dismiss)`** — it has been observed to silently fail inside sheets that combine `.keyboardShortcut` modifiers with focus-effect or other ambient modifiers. The closure approach has no such ambiguity: a button click flips a `@State Bool` on the parent and SwiftUI re-evaluates `.sheet(isPresented:)`.
  2. Visible **chevron-down** button (top-leading) — calls `onDismiss()` directly. Bound to `.keyboardShortcut(.cancelAction)` for keyboard backup.
  3. Visible **Done** button (top-trailing) — calls `onDismiss()` directly. Bound to `.keyboardShortcut(.defaultAction)`.
  4. **Tap on backdrop** outside the content — outer-layer `.onTapGesture(perform: onDismiss)` on the backdrop ZStack child; inner content layer uses `.contentShape(Rectangle()).onTapGesture { /* swallow */ }` so taps on buttons / sliders don't bubble up.
  5. **Local NSEvent.keyDown monitor** for `keyCode == 53` (Esc), installed in `.onAppear` and removed in `.onDisappear`. This is the safety net for when SwiftUI's `.cancelAction` shortcut doesn't reach the button due to focus-chain interference. Returning `nil` from the monitor consumes the event so no other handler also fires.
- [ ] **DO NOT attach nested `.sheet(isPresented:)` modifiers to `NowPlayingExpanded`.** When two `.sheet` modifiers share a view, SwiftUI honours only the most recently attached one — and worse, those nested presentations can hijack the parent sheet's keyboard shortcuts, silently breaking Esc / Return dismissal. If you need lyrics or queue access from the expanded view, dismiss this sheet first and re-open from `PlayerChrome`. Use a separate inspector pattern, not nested sheets.
- [ ] **Lyrics / Queue sheets**: Done button bound to `.keyboardShortcut(.defaultAction)` (Return). macOS sheets dismiss on Escape only when there's a button with `.cancelAction` in scope; we accept Return-only dismissal and ship a clearly-visible Done button.
- [ ] **`NowPlayingExpanded` content fits its sheet**: `cover (380) + spacing (44) + text-col min (320) + horizontal padding (40×2)` = 824 pt. Sheet is `minWidth: 880`. Earlier `380 + 48 + 460 + 64×2` demanded 1016 pt and clipped the right edge inside its own 980 pt minWidth.
- [ ] **Avoid `.focusEffectDisabled()` on a sheet that needs keyboard shortcuts.** It's safe on PlayerChrome (no .cancelAction / .defaultAction shortcuts there), but on a sheet with explicit `keyboardShortcut(.cancelAction|.defaultAction)` modifiers it can interfere with the focus chain that those shortcuts traverse. If you need to suppress focus rings on individual buttons, scope `.focusEffectDisabled()` to those buttons specifically.

## WebKit — the hidden audio engine

- [ ] **Hidden WebView MUST be parented to an off-screen NSWindow.** A bare `WKWebView(frame: .zero)` refuses to start audio playback regardless of `mediaTypesRequiringUserActionForPlayback = []`. Park it in a borderless, alpha-0, far-off-screen window with `collectionBehavior = [.transient, .ignoresCycle, .stationary]` so it doesn't appear in Cmd+\` rotation or migrate between Spaces.
- [ ] **Pin `WKUserScript` and every `evaluateJavaScript` call to `.page` content world.** Without explicit `WKContentWorld.page`, consecutive eval calls land in different `window`s and globals don't propagate. Diagnostic: a length round-trip on `__VIBEYTM_API_TRACE__` returns 1 from the init call but 0 from the snapshot poll — that's the smoking gun.
- [ ] **Card-click playback must use `player.loadVideoById`, not anchor-click navigation.** Programmatic `anchor.click()` events have `isTrusted = false`; YTM's polymer router routes the URL but refuses to auto-play. The IFrame Player API's `loadVideoById({ videoId, startSeconds })` respects the autoplay override and starts playback in one call. Calling `navigate()` afterward races the load and tears down the player — use ONE or the other, not both.
- [ ] **The first Innertube call after page load reliably fails with "Load failed" or times out.** Same root cause as the bridge JS's own `fetchAccountFromApi` recovery (logs `fetchAccount error: Load failed` on attempt 1, succeeds ~2.5 s later). `callYTMAPI` retries up to 5 times with backoff (500/1000/1500/2000/2500 ms) on both `.fetchFailed("Load failed"|"network…")` AND `.timeout`. Per-attempt timeout is 6 s, NOT 15 s — a stuck fetch should bail fast so the next attempt can swing.
- [ ] **`toggle_repeat` is the WRONG command name** — the bridge JS handler is `cycle_repeat`. Sending the wrong name silently no-ops; the repeat button looks dead. Verified against the cmd switch in `ytm-player-bridge.js`.

## State propagation

- [ ] **`__VIBEYTM_ACCOUNT__` must be merged into the snapshot envelope** AND propagated to `PlayerState.account` in `AppBootstrap.handle(snapshot:)`. Forgetting either half leaves the sidebar stuck on "Not signed in" forever even when the bridge has fetched the user's name and avatar.
- [ ] **Sign-out drops `account`**: when `loggedIn` flips false and `snapshot.account` is nil, set `next.account = nil`. Otherwise the avatar persists across sign-out.
- [ ] **`pendingResume` only fires on first `loggedIn=true`**: clear `pendingResumeVideoId` after the first consume so a transient logout/login doesn't yank the user back to the saved track.

## Innertube parser robustness

- [ ] **Parser must handle TWO top-level shapes:** `singleColumnBrowseResultsRenderer` (Home / Explore / library) AND `twoColumnBrowseResultsRenderer` (albums `MPRE…`, artists, "two-column" pages). The latter splits content across `tabs[N].tabRenderer.content` and `secondaryContents` — walk both. Add a deep-walker fallback for unanticipated shapes.
- [ ] **Section types: `musicCarouselShelfRenderer`, `musicShelfRenderer`, `musicPlaylistShelfRenderer`** are all valid. Albums use `musicShelfRenderer` with NO `title` field — synthesize "Tracks" rather than bailing on `title.isEmpty`.
- [ ] **`parseMusicShelf` requires items, not title**: the guard is `guard !items.isEmpty else { return nil }`, NOT `guard !title.isEmpty`. The page header renders the album/playlist title separately.

## Persistence

- [ ] **Throttle, NOT debounce.** The bridge polls every 150 ms; a debounce-style writer with a 500 ms timer keeps cancelling itself and never writes. Use a 2 s throttle (re-arming-free): write immediately if cooldown passed, drop otherwise.
- [ ] **Synchronous flush on `applicationWillTerminate`.** Without it, the user's last position update is lost on quit when the throttle hadn't elapsed. Register the observer in `AppBootstrap.installShutdownHook()` from the WindowGroup `.task`.
- [ ] **Resume persistence is a one-shot on launch.** `consumePendingResumeIfReady` clears `pendingResumeVideoId` after consuming so a later transient logout/login doesn't re-trigger.

## Image cache

- [ ] **Hash filenames with `SHA256`, NOT `Hasher`.** Swift's `Hasher` is salted per process — files written one launch are unreachable the next. Use `CryptoKit.SHA256.hash(data:).map { String(format: "%02x", $0) }.joined()`.
- [ ] **Inflight dedup**: a `[URL: Task<Data?, Never>]` table coalesces concurrent requests for the same URL into one network task.
- [ ] **Trim runs off-actor**: a detached background task scans the directory and prunes oldest files when total bytes exceed the 1 GB ceiling. Atomic writes mean readers always see complete files.

## Filter modules — DO NOT BREAK

These are pure-logic ports of the WKWebView quirks documented in the React/Tauri `CLAUDE.md`. They have parity with `seekFilter.test.ts`, `volumeSettle.test.ts`, etc. Touching them re-opens the original bugs.

- [ ] **`SeekFilter`**: `SEEK_TOLERANCE_SECS = 2`, `SEEK_RECONCILE_WINDOW_MS = 5000`. Drops every POSITION_UPDATED > tolerance from the seek target until either we see a near-target position (clears pending) or 5 s elapse (hard cap).
- [ ] **`VolumeSettle`**: `pushSettle = 2.0`, `disagreementThreshold = 0.01`, `emitThreshold = 0.001`. Two halves: (a) trust storedVolume over reportedVolume during the settle window AND on `trackChanged`, (b) only emit when effective volume actually changes. Removing either half re-opens issue #76.
- [ ] **`TrackChangeGuard`**: `reconcileWindow = 1.5 s`. Only arms when `bridge.hasTrack` AND `videoId` actually changed — not on metadata refinement (duration grows, title/artist/artwork refines).
- [ ] **`BridgeReducer`** composes them in this order: track-change → position filter → seek filter → volume settle → assemble PlayerState. Order matters; reordering changes the semantics.

## Verification before declaring done

- [ ] **Build clean**: `bash app/build.sh --install` — ad-hoc signed `.app` bundle assembled, signature verified, copied to `~/Applications`.
- [ ] **Launch & screenshot**: `open ~/Applications/VibeYTM.app`, find window via `CGWindowListCopyWindowInfo`, `screencapture -x -l <wid>`. Filter the hidden bridge window (alpha 0, x = -10000) when finding the visible window.
- [ ] **Bridge log**: `/tmp/vibeytm-bridge-debug.log` shows the JS bridge's last 15 ring entries. Healthy: `bridge loaded`, `player found`, `queue observer attached`, `queue (N items)`, `fetchAccount: status=200`, NO `stuck at 0s` lines.
- [ ] **Track plays AND auto-advances**: position advances through 1 second of wall-clock, eventually reaches the end, then a new `bridge loaded on /watch?v=...` log entry appears for the next track. If the track sits at 0:00 with `stuck at 0s` retries, autoplay is broken.
- [ ] **Sidebar visual check**: zoom on the leftmost edge of the window. Every icon's leftmost stroke must be visible — no clipping by the rounded corner. Every label must render fully (no `…` truncation).
- [ ] **Album / playlist drilldown populates**: click a card from Home or Explore that pushes a `BrowseDestination`. The detail view must show the cover header AND a "Tracks" shelf with rows. Empty state ("No content") means the parser missed the response shape.
