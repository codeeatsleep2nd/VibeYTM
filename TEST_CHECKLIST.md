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

## Login Flow
- [ ] App launches with two windows (VibeYTM + YouTube Music)
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
