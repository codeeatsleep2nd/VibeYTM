# VibeYTM — UI Test Checklist

## MANDATORY PRE-BUILD VERIFICATION
Before EVERY build, verify these rules are implemented correctly:

### Card Click Rules — ALL PAGES (CRITICAL)
Apply to: Home, Search (Albums/Artists tabs), Explore, Library, Playlist detail
- [ ] Every card in every shelf must be clickable (no React key collisions)
- [ ] Single-video cards (watchEndpoint.videoId only, no browseId) → clicking plays the track directly
- [ ] Playlist/album cards → clicking opens the detail page (no auto-play)
- [ ] Clicking play icon on a collection → plays first track
- [ ] Clicking play icon on a single-track card → plays that track
- [ ] Parser must detect `musicTwoRowItemRenderer` with watchEndpoint as Song, not Album
- [ ] React keys use `${id || 'fallback'}-${index}` pattern to prevent collisions
- [ ] **Card click target MUST be a real `<button>` element, NOT `<div role="button">`** — see "WKWebView quirk: div role=button swallows onClick" below

### WKWebView quirks — REGRESSION TRAPS
- [ ] **Click targets are real `<button>` elements**: `<div role="button" tabIndex={0}>` looks equivalent and passes a11y, but in this Tauri WKWebView build the synthetic React onClick is silently dropped (mouse hover still fires; only click is broken). Verified with diagnostic IPC — zero pings landed despite repeated clicks. ALWAYS use a real `<button>`. If you need to avoid nested-button HTML, swap the INNER element to a `<span role="button" onClick={...}>` rather than swapping the outer wrapper.
- [ ] **No `pointer-events: none` on stale-while-revalidate overlays**: `ReloadOverlay`-style wrappers must NOT block pointer events on cached children during a refresh — that turns every card into a click-dead surface for the duration of any YTM bridge stall (~30 s during webview navigation). Use a small corner spinner that itself has `pointerEvents: 'none'`, but leave the children fully interactive.
- [ ] **`ReloadOverlay` MUST blur the children** with `filter: blur(10px)` while a refetch is in flight. The blur is the visual stale-while-revalidate cue ("data is being refreshed in place"). CSS `filter` does NOT affect hit testing — clicks still pass through, so the blur and the click-through-children rule above are independent. An earlier fix accidentally removed the blur together with a click-blocker; only the click-blocker was the bug. If the home page stops blurring on refresh again, the regression is in `src/components/LoadingOverlay.tsx`.
- [ ] **`ReloadOverlay`'s children-wrapping layer must have NO `transform`.** `transform: scale(...)` creates a stacking context that WKWebView mishandles for hit-testing — clicks on some children stop registering. An attempt to add `scale(0.98)` to hide the blur halo broke clicks across Home / Explore / Library. Use blur alone; transforms on the wrapper are forbidden. Locked in by the contract test in `src/components/LoadingOverlay.test.tsx`.
- [ ] **Children of closed overlays must NOT set `pointer-events: auto`.** A child with explicit `pointer-events: auto` overrides its parent's `pointer-events: none`. For fixed-position panels (`NowPlaying`, `QueuePanel`, future overlays) any inner element that toggles its own pointer-events must AND with the parent's `isOpen`: `pointerEvents: isOpen && childIsActive ? 'auto' : 'none'`. Without this, opening the panel + sub-feature (e.g. LRC), then navigating away via the sidebar, leaves an invisible click-stealing region where the panel used to be. The sidebar `onNavigate` handler in `src/App.tsx` must also reset every overlay flag — `setIsNowPlayingOpen(false)`, `setIsLyricsOpen(false)`, `setIsQueueOpen(false)` — for the same reason.
- [ ] **Background fetches debounced past YTM webview navigation**: every track change forces YTM's audio webview to navigate, hanging in-flight `fetch()` calls for ~3-15 s. Background calls (queue refresh, lyrics preload, current-track lyrics probe) must wait ~1.5-2 s after a track change so they don't saturate the bridge channel and starve user-driven IPCs (`get_playlist`, `search`).

### Playlist Card Click Rules (CRITICAL)
- [ ] Click anywhere on card (NOT play icon) → opens playlist detail page, NO auto-play
- [ ] Click play icon on card → opens detail page AND plays first song
- [ ] If currently playing song is already in the playlist → open detail page but do NOT restart playback
- [ ] PlaylistDetailPage `autoPlay` prop only triggers play when explicitly requested

### Content Parity with Real YTM (CRITICAL)
- [ ] Use Playwright/Chrome DevTools MCP to check https://music.youtube.com/ before building
- [ ] Home page sections must match real YTM: Listen again, Trending community playlists, Music channels you may like, Throwback hits, etc.
- [ ] Explore page must have: New albums & singles, Trending, New music videos, Moods & genres
- [ ] Library tabs must load real data (Playlists, Songs, Albums, Artists)
- [ ] Search category filters must return appropriate results per category

### First Launch Behavior
- [ ] First time the app is opened in a session → home page must force refresh (don't use cache)
- [ ] Subsequent navigation → use cache unless > 30 min old OR user clicks refresh button

## Known Issues Fixed (2026-04-11)
- **Root cause of all playback issues**: Tauri IPC (`invoke()`) is NOT available for
  external URLs like `music.youtube.com`. The JS bridge was calling `invoke()` which
  silently failed. Fix: Changed to a pull-based architecture where Rust polls the
  YTM WebView state via `document.title` trick (eval JS → write state to title → read
  title from Rust).
- **Album artwork**: Mock data used `maxresdefault.jpg` (not available for all videos)
  and `lh3.googleusercontent.com/placeholder` (fake URL). Fixed to `hqdefault.jpg`.
- **Volume slider**: Rust stores volume as 0.0-1.0 but slider expects 0-100. Fixed
  with `Math.round(volume * 100)`.

## Regression Checklist for 0.6.0
- [ ] **#34** Track duration renders correctly on start (no 4:12-shown-as-0:29)
- [ ] **#34** Duration never shrinks once a real length is reported
- [ ] **#35** Settings page shows ⌘⇧Space / ⌘⌥→ / ⌘⌥← matching registered shortcuts
- [ ] **#36 / #42** Clicking the volume bar lands on the target position, no bounce
- [ ] **#37** After sign-out, player bar returns to "No track playing" and sidebar
      avatar clears within ~2s
- [ ] **#38** Sidebar avatar/name do NOT flicker on track change
- [ ] **#39** Cover art shows album artwork (not the video frame) for songs with
      music videos such as "Despacito — Pop Version"
- [ ] **#40** A track that stalls at 0:00 auto-recovers within ~4 seconds
- [ ] **#41** Clicking the progress bar while playing does NOT flash paused
- [ ] **#43** "Close to tray" toggle persists across restarts. With it OFF, the
      red close button exits the app. With it ON, the app hides to the tray.

## Regression Checklist for 0.7.0
- [ ] **#24** Closing the app and relaunching restores the last-played track
      name, artwork, duration, and progress bar position (no autoplay — status
      stays idle until user clicks Play). Works even if closed within 5 s of
      playback starting.
- [ ] **#41** Clicking the progress bar while a track is playing (or buffering
      mid-seek) NEVER flashes the pause glyph. Pausing manually still works
      instantly.
- [ ] **#44** When YTM raises a playback error (e.g. region-blocked track),
      the app retries playback automatically — `playVideo()` once, then
      `seekTo(0)+play`, then `nextVideo()` — instead of freezing the queue.
- [ ] **#45** Settings → About displays the true bundled app version
      (pulled at runtime from the Tauri app API, not a build-time fallback).
- [ ] **#46** Playlist detail page shows a "+ Save to library" button.
      Clicking saves the playlist to the user's library; the button flips to
      "✓ Saved" and a second click removes it.
- [ ] **#47** With Background playback = OFF, closing the main window (tray
      mode) pauses the music immediately. With it ON, audio continues.
- [ ] **#48** Non-square cover images (e.g. 16:9 video thumbnails) display
      letterboxed inside the square frame instead of being aggressively
      center-cropped. Square album art still fills the frame edge-to-edge.
- [ ] **#50** After sign-out, the sidebar avatar and name clear to
      "Not signed in" and the home-page cache is dropped so the feed
      refreshes with non-signed-in content on next visit.
- [ ] **#51** If the user is already signed in, launching the app no longer
      flashes the LoginPage or the YTM window — it boots directly into the
      main UI. The YTM window is only surfaced when sign-in is needed.

## Regression Checklist for 0.8.0
- [ ] **#54 / #55** Opening a playlist or album you have already saved
      shows "✓ Remove from Library" on first paint. Opening one you have
      not saved shows "+ Save to Playlists" (or "+ Save to Albums" for an
      MPRE album). Toggling once succeeds and the next reopen reflects the
      new state. The save call actually mutates your library on YTM.
- [ ] After removing a saved playlist/album, clicking Back to the Library
      page shows the item gone — no need to navigate away and return.
- [ ] **#56** Cold launch shows a branded welcome screen (♪ logo + "VibeYTM"
      + "Tuning in…") from the moment the window appears. It fades out
      smoothly once Home shelves are painted. With `prefers-reduced-motion`
      enabled, the splash hides without animation.
- [ ] **#57** Clicking the progress bar near the very end of a short track
      (e.g. a 1:10 song clicked at ~1:08) NEVER causes the player to stop
      with a stale cover/title and the next song's duration. Either it
      seeks slightly back from the end and keeps playing, or transitions
      cleanly to the next track with all metadata in sync.
- [ ] **#58** On the Search page, the search bar and the category filter
      tabs stay pinned at the top while results scroll underneath, mirroring
      the Home page's sticky greeting + mood tabs.
- [ ] **#59** Each page's title aligns vertically with its corresponding
      sidebar nav button — Home greeting with Home, Search bar with Search,
      Library tab title with the Library section, Explore title with
      Explore, Settings title with Settings, playlist Back button with the
      sidebar nav row.

## Regression Checklist for 0.9.10
- [ ] **About window** macOS menu **VibeYTM → About VibeYTM** opens a small
      dark dialog (380×240, non-resizable). Shows "VibeYTM",
      "Version <bundled-version>", "Built with Tauri + React",
      "A YouTube Music desktop client", and a clickable
      "Visit ytm.gleevibe.ai for more information" line. Clicking the link
      opens **the system default browser** — never navigates inside the
      about window itself. Version number must match what Settings → About
      shows (single source of truth via `get_about_info` IPC).
- [ ] **Settings cache stats** Settings → Cache row reads
      "X.Y MB / Z.Z MB — N images, N tracks, N lyrics". Lyric count
      increments after a synced-lyric track has been played and lyrics
      cached to disk; "Clear cache" zeroes all three counts.
- [ ] **Search recents** First open of Search shows "Search YouTube Music"
      placeholder (empty state). After submitting a query, navigating away,
      and reopening Search, the empty state shows "Recent searches" with
      the most recent query as the leftmost chip. At most 5 chips.
      Clicking a chip re-runs the search. "Clear" affordance empties the
      list. Persists across app restarts.
- [ ] **Lyrics line wrap** Long lyric lines (CJK without spaces, very long
      English) wrap to the next line within the lyric panel — never
      overflow horizontally.
- [ ] **Lyric/Queue cover-shift parity** When the queue drawer slides in
      from the right (with Now Playing open), the cover-column shifts left
      to the same position it occupies when the lyrics drawer is open.
      Closing both drawers re-centers the cover.
- [ ] **Volume bar width** Volume slider in the player bar is ~55px wide,
      noticeably more compact than before (was 83px).
- [ ] **Seek does not desync lyrics** Click the progress bar mid-track to
      jump forward or backward by ≥ 30 s. The lyric panel must scroll to
      the new line and stay there — no flash to an old line, no slow
      reverse-drift. Verified by `seekFilter.test.ts` for the pure echo
      filter; this manual check covers the end-to-end YTM-bridge path
      where a stale pre-seek POSITION_UPDATED can arrive 1-4 s after the
      seek and previously snapped `useSmoothedPosition` backward.
- [ ] **No volume burst on track change** Set the volume to a non-default
      level (say 30%), let the track end, and listen carefully as the next
      track starts. Audio must come in at the user-set level — no audible
      jump-to-default before clamping. Repeat for an explicit Next click.
      The fix routes the desired volume through `localStorage` on the YTM
      origin so the bridge's prototype-level volume lock is armed before
      YTM creates the new `<video>` element.
- [ ] **#76 Volume slider does NOT jump to max after track change.** Set
      the volume to ~30%, let several minutes pass without touching the
      slider (frontend echo window expires), then let YTM auto-advance to
      a new track. The slider thumb must stay at 30% — no visible snap to
      100% before settling back. Same for an explicit Next click. Backed
      by the `last_emitted_volume` change-gate + `VOLUME_PUSH_SETTLE_MS`
      reconcile window in `webview_bridge/poller.rs`.

## Login Flow
- [ ] First launch (no cached session): LoginPage appears and the YouTube
      Music window surfaces automatically so the user can sign in
- [ ] Relaunch while already signed in: no LoginPage, no YTM window flash —
      the main UI appears directly (issue #51)
- [ ] YouTube Music page loads without "unsupported browser" error
- [ ] Can sign in to Google account (2FA works)
- [ ] "I'm signed in — let's go" hides YTM window and shows main UI
- [ ] "Skip for now" shows main UI without signing in
- [ ] "Show YouTube Music window" button in login page works
- [ ] "Show YouTube Music window" button in Settings works

## Sidebar Navigation
- [ ] Clicking Home shows home page with greeting
- [ ] Clicking Search shows search page with input
- [ ] Clicking Explore shows genre cards grid
- [ ] Clicking Playlists shows library with playlist tab active
- [ ] Clicking Songs shows library with songs tab
- [ ] Clicking Albums shows library with albums tab
- [ ] Clicking Artists shows library with artists tab
- [ ] Clicking Settings shows settings page
- [ ] Active nav item is highlighted

## Home Page
- [ ] Time-based greeting displays (morning/afternoon/evening)
- [ ] "Quick picks" shelf shows song rows with artwork thumbnails
- [ ] "Recommended albums" shelf shows album cards with cover art loaded
- [ ] "Recently played" shelf shows song rows
- [ ] All artwork images load (no broken images)
- [ ] Clicking a song row navigates YTM and starts playback

## Player Bar — Playback Feedback (critical path)
- [ ] After clicking a song: title updates from "Loading..." to real title
- [ ] After clicking a song: artist name appears
- [ ] After clicking a song: artwork thumbnail appears
- [ ] Play/pause button toggles icon (▶ ↔ ❚❚) when status changes
- [ ] Status dot turns green when playing
- [ ] Progress bar moves in real time
- [ ] Time display updates (m:ss format)
- [ ] Duration shows correct total time

## Player Bar — Controls
- [ ] Shows "No track playing" when idle
- [ ] Play/pause actually controls playback in hidden YTM
- [ ] Next/Previous buttons work
- [ ] Shuffle button toggles active state (accent color)
- [ ] Repeat button cycles: none → all → one → none
- [ ] Progress bar is draggable (seek)
- [ ] Volume slider moves and persists position visually
- [ ] Volume changes affect playback volume in YTM
- [ ] Like button toggles (♡ ↔ ♥)
- [ ] Queue toggle button opens/closes Now Playing sidebar

## Search Page
- [ ] Search input is focused and styled
- [ ] Typing >= 2 characters triggers search after 300ms debounce
- [ ] Results show Songs, Albums, Artists sections
- [ ] Song results are clickable and start playback
- [ ] Empty state shows "Search YouTube Music"

## Explore Page
- [ ] 8 genre cards displayed in grid
- [ ] Each card has distinct color
- [ ] Cards have hover brightness effect

## Library Page
- [ ] Tab bar shows Playlists/Songs/Albums/Artists
- [ ] Active tab has accent underline
- [ ] Playlists tab shows playlist list with track counts
- [ ] Other tabs show "Coming soon"

## Now Playing Sidebar
- [ ] Opens/closes with queue button
- [ ] Shows large artwork when track is playing
- [ ] Shows track title, artist, album
- [ ] Shows "Up Next" queue list
- [ ] Shows "No track playing" when idle
- [ ] Smooth slide animation on open/close

## Settings Page
- [ ] "General" section with toggle switches
- [ ] "Integrations" section with notifications toggle
- [ ] "Keyboard Shortcuts" section with shortcut badges
- [ ] "YouTube Music" section with show/hide/reinject buttons
- [ ] "About" section with version info
- [ ] Toggle switches animate on click

## System Integration (requires built app)
- [ ] System tray icon appears
- [ ] Tray menu shows Play/Pause, Next, Previous, Quit
- [ ] Tray menu items control playback
- [ ] Global shortcuts work (Cmd+Shift+Space, Right, Left)
- [ ] Desktop notification on track change
