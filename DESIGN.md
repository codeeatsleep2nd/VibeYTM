# VibeYTM — System Design & Implementation Plan

*An Apple Music-style YouTube Music desktop app built with Tauri 2.x + Rust + React*

---

## 0. Design System — One-Page Cheatsheet

The system this app is actually built against. Read this before adding a new
component or choosing a value inline. The deeper architecture sections below
remain canonical for IPC, state, and data flow; for visual language, this
cheatsheet supersedes the older §9 token block.

### North star

Apple-Music-style desktop music player. Dark luxury, OKLCH palette, Liquid
Glass surfaces refracting an ambient page gradient. Visual fidelity to Apple
Music is the rubric — when in doubt, pull a real screenshot of
music.apple.com (per CLAUDE.md "Visual fidelity" rule), don't design from
memory.

### Palette (OKLCH only — no hex, no rgb)

Authoritative source: `src/styles/tokens.css`. The tokens listed here mirror
that file at the time of writing; treat tokens.css as the source of truth.

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `oklch(10% 0.005 270)` | Page base. |
| `--color-surface-1/2/3` | `14% / 18% / 22%` lightness | Card / row / hover surfaces. |
| `--color-text-primary` | `oklch(95% 0 0)` | Body, titles. |
| `--color-text-secondary` | `oklch(82% 0 0)` | Subtitles, secondary metadata. |
| `--color-text-tertiary` | `oklch(75% 0 0)` | Labels, time codes, tertiary chrome. |
| `--color-accent` | `oklch(63% 0.258 29)` | YouTube red. The ONLY accent color. |
| `--color-accent-hover` | `oklch(69% 0.258 29)` | Lifts lightness, holds hue/chroma. |

The ambient page gradient (`--ambient-tint-1` violet, `--ambient-tint-2`
red) exists ONLY to give Liquid Glass surfaces something to refract. It must
never read as foreground content.

### Liquid Glass — three tiers

Every glass surface uses `backdrop-filter: blur(...) saturate(220%)
brightness(1.05)`. The saturate boost keeps the bleed-through from
desaturating to gray.

| Tier | Token | Where |
|---|---|---|
| Chrome | `--glass-bg-chrome` (0.40 opacity) | Sidebar, player chrome, queue drawer. |
| Card | `--glass-bg-card` (0.30) | Album cards, song rows, content surfaces. |
| Subtle | `--glass-bg-subtle` (0.18) | Section headers, faint background tints. |

Rim brightness: `--glass-rim-bright/mid/dim` for plate edges. Bright on the
player chrome, mid on sidebars, dim on cards.

### Typography

System font stack — `-apple-system, BlinkMacSystemFont, 'SF Pro Text',
'Helvetica Neue', Arial, sans-serif`. On macOS this resolves to SF Pro,
which is the right Apple Music expectation. Cross-platform behavior: revisit
when shipping on Windows / Linux.

| Token | Pixel | Use |
|---|---|---|
| `--text-xs` | 11 | Tertiary labels, sidebar section headers. |
| `--text-sm` | 13 | Sidebar nav, button captions, metadata. |
| `--text-base` | 15 | Body. |
| `--text-lg` | 18 | Subheads, in-card titles. |
| `--text-xl` | 22 | Detail-page secondary headings. |
| `--text-2xl` | 28 | Detail-page H1 (album / playlist titles). |
| `--text-display-sm` | 26 | Section H2 on Home/Explore (Listen again, ...). |
| `--text-display` | 32 | Page-level H1 (greeting, page title). |

Hierarchy on Home: greeting (`--text-display`) > section H2
(`--text-display-sm`) > content. Letter-spacing tightens as size grows:
`-0.025em` at display sizes, `-0.02em` at 2xl, `-0.01em` at lg.

### Spacing — 4px grid

`--space-1` (4) through `--space-16` (64). No half-steps. If a layout needs
6px, you're solving the wrong problem. `--sidebar-width: 240`,
`--player-bar-height: 72`, `--title-bar-height: 38`,
`--now-playing-width: 320` — fixed, do not inline-override.

### Radius

`--radius-sm` (4) inline pills, `--radius-md` (8) buttons + nav items,
`--radius-lg` (12) cards, `--radius-xl` (16) hero surfaces, `--radius-full`
circular.

### Motion

| Token | ms | Use |
|---|---|---|
| `--duration-fast` | 100 | Hover, focus, slider thumb size. |
| `--duration-normal` | 200 | Page chrome reveals, button state. |
| `--duration-slow` | 400 | Overlay opens (NowPlaying, Lyrics, Queue). |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Apple ease-out-expo. Default. |

`prefers-reduced-motion: reduce` flattens animation/transition to 0.01ms via
the global rule in `global.css`. Add overrides for any new keyframe.

### Banned patterns (WKWebView landmines from CLAUDE.md)

These are not opinions, they are documented bug traps:

- **Real `<button>` for click targets.** `<div role="button">` silently
  drops onClick in this WKWebView. Inner spans with `role="button"` are OK
  to avoid nested buttons.
- **No `transform` on `ReloadOverlay`'s children-wrapping layer.** Creates
  a stacking context WKWebView mishandles for hit-testing. Blur is the cue;
  transform is forbidden.
- **No `pointer-events: none` on a wrapper that should keep cards
  clickable** during refresh. Block events on a tiny corner spinner only.
- **AND child `pointer-events: auto` with parent open state** — otherwise
  an inert-looking overlay steals clicks.
- **No video thumbnails on cards.** Album art only, filtered by
  `isAlbumArtUrl` or recovered via `useAudioCounterpartArtwork`.
- **State pushed to YTM via IPC must persist to YTM-origin localStorage**
  so the bridge can re-seed before the new `<video>` exists. See volume /
  account / shuffle / repeat seed-then-persist in CLAUDE.md.

### When to add a token vs inline a value

If you reach for an inline value not in this doc and it will recur, add a
token. If it's a one-off, inline is fine — but leave a code comment naming
the one-offness so the next reader doesn't assume it's a system value.

### When to extract a component

After two copies of the same JSX block. Three is the abstraction threshold.
Files cap at ~400 lines; split by sub-component when bigger.

---

## 1. Architecture Overview

The key insight: **YouTube Music's web player is hidden**. It runs in an invisible WebView purely as an audio engine. The user sees only our custom React UI, styled like Apple Music.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           VibeYTM Application                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                Custom UI (React + TypeScript)                      │  │
│  │                                                                    │  │
│  │  ┌───────────┐ ┌──────────────────────────────┐ ┌──────────────┐  │  │
│  │  │           │ │                              │ │              │  │  │
│  │  │  Sidebar  │ │      Main Content Area       │ │  Now Playing │  │  │
│  │  │           │ │                              │ │  / Queue     │  │  │
│  │  │  - Home   │ │  Album Grid / Song List /    │ │  Sidebar     │  │  │
│  │  │  - Search │ │  Artist Page / Playlist      │ │              │  │  │
│  │  │  - Library│ │                              │ │              │  │  │
│  │  │  - Explore│ │                              │ │              │  │  │
│  │  │           │ │                              │ │              │  │  │
│  │  └───────────┘ └──────────────────────────────┘ └──────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────────────┐    │  │
│  │  │              Player Bar (bottom, always visible)           │    │  │
│  │  │  [artwork] title / artist    ◄◄  ▶  ►►   ━━━━●━━  🔊 ♡  │    │  │
│  │  └────────────────────────────────────────────────────────────┘    │  │
│  └────────────────────────────────────┬───────────────────────────────┘  │
│                                       │ Tauri IPC (invoke / listen)      │
│  ┌────────────────────────────────────┼───────────────────────────────┐  │
│  │                        Rust Backend                                │  │
│  │                                                                    │  │
│  │  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌──────────────────┐   │  │
│  │  │ Player   │ │ YTM Data  │ │ Media      │ │ Integrations     │   │  │
│  │  │ State    │ │ Service   │ │ Controls   │ │ (Notifications,  │   │  │
│  │  │ Manager  │ │ (ytmusic  │ │ (OS keys,  │ │  Global          │   │  │
│  │  │          │ │  api)     │ │  NowPlay)  │ │  Shortcuts)      │   │  │
│  │  └────┬─────┘ └────┬──────┘ └─────┬──────┘ └──────┬───────────┘   │  │
│  │       └─────────────┴──────────────┴───────────────┘               │  │
│  │                    Event Bus (tokio broadcast)                      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │               Hidden WebView (music.youtube.com)                   │  │
│  │               Audio engine only — user never sees this             │  │
│  │               JS Bridge polls player state + controls playback     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Tauri Plugins: media | global-shortcut | notification | store    │  │
│  │                  shell | log | deep-link | updater                 │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Two WebViews, One App

| WebView | Purpose | Visible? |
|---------|---------|----------|
| **Main WebView** | Custom React UI (Apple Music-style) | Yes |
| **Hidden WebView** | Loads `music.youtube.com`, plays audio | No (zero-size, off-screen) |

The hidden WebView handles authentication (Google login), DRM, and audio playback. The React UI communicates with it through the Rust backend acting as a message broker.

### Data Flow

```
React UI ──invoke──► Rust ──eval_js──► Hidden YTM WebView
                                              │
React UI ◄──event─── Rust ◄──invoke─── JS Bridge (polls player)
```

1. User clicks "Play" in React UI → `invoke('playback_command', { cmd: 'play' })`
2. Rust receives command → evaluates JS in hidden WebView: `player.playVideo()`
3. JS bridge in hidden WebView detects state change → `invoke('on_track_changed', {...})`
4. Rust updates `PlayerState` → emits event to React UI
5. React UI re-renders player bar with new track info

### Design Principles

1. **Separation of Concerns** — UI knows nothing about YouTube Music internals. It speaks to Rust in terms of "play this track", "search for X". Rust translates to YTM operations.

2. **Event-Driven Architecture** — All state changes flow through a central event bus. Components subscribe to events they care about. Every event is logged for debuggability.

3. **Plugin-Based Extensibility** — Each integration (notifications, global shortcuts) is a self-contained module implementing an `Integration` trait. Adding a new integration = one new file, zero changes to core code.

4. **Single Source of Truth** — `PlayerState` in Rust is canonical. The React UI subscribes to it. The JS bridge updates it. No one else mutates it.

5. **Observable Everything** — Every state transition emits a structured log. The app includes a built-in debug panel showing the event stream in real time.

---

## 2. UI Design — Apple Music Style

### Layout Anatomy

```
┌────────────────────────────────────────────────────────────────┐
│  Traffic lights    ◄ ►    🔍 Search...              ≡         │  ← Title bar
├──────────┬─────────────────────────────────────┬───────────────┤
│          │                                     │               │
│  Home    │  Good Evening                       │  Now Playing  │
│  Search  │                                     │               │
│  Explore │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │  ┌─────────┐ │
│          │  │album│ │album│ │album│ │album│   │  │ artwork │ │
│ ──────── │  │ art │ │ art │ │ art │ │ art │   │  │         │ │
│ LIBRARY  │  └─────┘ └─────┘ └─────┘ └─────┘   │  └─────────┘ │
│  Playlst │  Quick Picks           Recently...  │  Song Title   │
│  Songs   │                                     │  Artist Name  │
│  Albums  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │               │
│  Artists │  │album│ │album│ │album│ │album│   │  ━━━●━━━━━━━  │
│          │  │ art │ │ art │ │ art │ │ art │   │  2:31 / 4:05  │
│ ──────── │  └─────┘ └─────┘ └─────┘ └─────┘   │               │
│ PINNED   │                                     │  Up Next      │
│  Chill   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │  ┌──┐ Song A │
│  Focus   │  │     │ │     │ │     │ │     │   │  ┌──┐ Song B │
│          │  │     │ │     │ │     │ │     │   │  ┌──┐ Song C │
│          │  └─────┘ └─────┘ └─────┘ └─────┘   │               │
├──────────┴─────────────────────────────────────┴───────────────┤
│  ┌──┐                                                          │
│  │♫ │ Bohemian Rhapsody · Queen    ◄◄  ▶  ►►   ━━●━━━  🔊  ♡ │  ← Player bar
│  └──┘                                                          │
└────────────────────────────────────────────────────────────────┘
```

### Visual Language

Inspired by Apple Music on macOS Tahoe (Liquid Glass era):

| Element | Treatment |
|---------|-----------|
| **Sidebar** | Semi-transparent, frosted glass effect. Navigation icons + text. Collapsible. |
| **Content area** | Album art grids with generous spacing. Rounded corners (12px). Hover reveals play button overlay. |
| **Player bar** | Fixed bottom. Album art thumbnail, track info, centered transport controls, progress bar, volume. Background tints from album art dominant color. |
| **Now Playing sidebar** | Right panel. Large artwork, lyrics, queue. Toggleable. |
| **Typography** | SF Pro (system font). Clear hierarchy: section headers bold, track titles medium, metadata regular muted. |
| **Colors** | Dark mode default. Surfaces at 3 elevation levels. Accent color extracted from current album art. |
| **Motion** | Crossfade on view transitions (200ms). Scale-up on album hover (1.02x). Smooth progress bar. No gratuitous animations. |

### Key Views

| View | What It Shows | Data Source |
|------|---------------|-------------|
| **Home** | Personalized mixes, recently played, quick picks | YTM home page data |
| **Search** | Search bar + results (songs, albums, artists, playlists) | YTM search API |
| **Explore** | Charts, new releases, moods & genres | YTM browse data |
| **Library > Playlists** | User's playlists | YTM library |
| **Library > Songs** | Liked songs | YTM library |
| **Library > Albums** | Saved albums | YTM library |
| **Library > Artists** | Subscribed artists | YTM library |
| **Album Detail** | Track list, artwork, artist, year | YTM album page |
| **Artist Detail** | Bio, top songs, albums, similar artists | YTM artist page |
| **Playlist Detail** | Track list, metadata | YTM playlist page |
| **Now Playing** | Large artwork, lyrics, queue | Current playback |
| **Settings** | Integration toggles, shortcuts, appearance | Local store |

---

## 3. Data Architecture — YTM Data Service

Since we're building our own UI, we need to **extract data from YouTube Music**, not just playback state. Two approaches work together:

### Approach 1: Hidden WebView Scraping

The hidden WebView loads YouTube Music pages and extracts structured data via JS injection:

```javascript
// Navigate to home page, extract recommendations
window.location.href = 'https://music.youtube.com/';
// Wait for page load, then scrape shelf contents

// Navigate to search
window.location.href = 'https://music.youtube.com/search?q=queen';
// Extract search results from DOM
```

### Approach 2: ytmusicapi (Rust port or HTTP bridge)

Use the [ytmusicapi](https://github.com/sigma67/ytmusicapi) protocol — it reverse-engineers YouTube Music's internal API by sending the same HTTP requests the web client does:

```rust
// src-tauri/src/ytm_api/mod.rs

pub struct YtmApi {
    client: reqwest::Client,
    auth_headers: HashMap<String, String>, // extracted from WebView cookies
}

impl YtmApi {
    pub async fn search(&self, query: &str) -> Result<SearchResults> { ... }
    pub async fn get_home(&self) -> Result<Vec<Shelf>> { ... }
    pub async fn get_album(&self, browse_id: &str) -> Result<Album> { ... }
    pub async fn get_artist(&self, channel_id: &str) -> Result<Artist> { ... }
    pub async fn get_playlist(&self, playlist_id: &str) -> Result<Playlist> { ... }
    pub async fn get_library_playlists(&self) -> Result<Vec<Playlist>> { ... }
    pub async fn get_liked_songs(&self) -> Result<Vec<Track>> { ... }
    pub async fn get_lyrics(&self, video_id: &str) -> Result<Lyrics> { ... }
}
```

**Auth strategy:** When the user logs into Google in the hidden WebView, we extract cookies/headers and use them for direct API calls. The hidden WebView remains for audio playback only.

### Data Flow for a Search

```
1. User types "Queen" in React search bar
2. React calls invoke('search', { query: "Queen" })
3. Rust YtmApi sends HTTP request to YTM internal API
4. Rust parses response → SearchResults { songs, albums, artists, playlists }
5. Rust returns to React via IPC
6. React renders results in Apple Music-style grid/list
7. User clicks a song → invoke('play_track', { video_id: "..." })
8. Rust tells hidden WebView to navigate and play that video
9. JS bridge reports playback started → PlayerState updates → UI updates
```

---

## 4. Project Structure

```
vibeytm/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
│
├── src/                              # React frontend
│   ├── main.tsx
│   ├── App.tsx                       # Root: layout shell + routing
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx          # Sidebar + content + now-playing layout
│   │   │   ├── Sidebar.tsx           # Left nav: Home, Search, Library sections
│   │   │   └── PlayerBar.tsx         # Fixed bottom player bar
│   │   │
│   │   ├── player/
│   │   │   └── NowPlaying.tsx        # Right sidebar: artwork, lyrics, queue
│   │   │
│   │   ├── browse/
│   │   │   ├── AlbumCard.tsx         # Single album art + title + artist
│   │   │   ├── SongRow.tsx           # Single song row
│   │   │   └── ShelfRow.tsx          # Horizontal scrollable row of cards
│   │   │
│   │   ├── pages/
│   │   │   ├── HomePage.tsx          # Personalized home with shelves
│   │   │   ├── SearchPage.tsx        # Search input + results
│   │   │   ├── ExplorePage.tsx       # Charts, new releases, genres
│   │   │   ├── LibraryPage.tsx       # Library sub-nav (playlists/songs/albums/artists)
│   │   │   ├── PlaylistDetailPage.tsx # Playlist tracklist
│   │   │   ├── SettingsPage.tsx      # Settings UI
│   │   │   └── LoginPage.tsx         # Login / authentication page
│   │   │
│   │   ├── CachedImage.tsx           # Image with local cache support
│   │   ├── MarqueeText.tsx           # Scrolling text for overflow
│   │   └── WelcomeScreen.tsx         # First-launch welcome screen
│   │
│   ├── hooks/
│   │   ├── usePlayerState.ts         # Subscribe to player state
│   │   ├── useLoginState.ts          # Login state tracking
│   │   ├── useAccountInfo.ts         # Account info fetching
│   │   └── useTauriEvent.ts          # Generic event listener
│   │
│   ├── lib/
│   │   ├── ipc.ts                    # Typed invoke() wrappers
│   │   ├── events.ts                 # Event constants + types
│   │   ├── colors.ts                 # Color extraction from images
│   │   └── types.ts                  # Shared TypeScript types
│   │
│   └── styles/
│       ├── tokens.css                # Design tokens (CSS custom properties)
│       └── global.css                # Reset + base styles
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   │
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs                    # App setup, plugin + state registration
│   │   │
│   │   ├── state/
│   │   │   ├── mod.rs
│   │   │   ├── player.rs             # PlayerState, TrackInfo, Queue
│   │   │   ├── settings.rs           # AppSettings
│   │   │   └── persistence.rs        # State persistence to disk
│   │   │
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── player.rs             # play, pause, next, prev, seek, volume
│   │   │   ├── browse.rs             # search, get_home, get_album, get_artist
│   │   │   ├── cache.rs              # image cache management
│   │   │   └── settings.rs           # get/set settings
│   │   │
│   │   ├── ytm_api/
│   │   │   ├── mod.rs                # YtmApi struct + auth
│   │   │   └── types.rs              # API response types
│   │   │
│   │   ├── webview_bridge/
│   │   │   ├── mod.rs                # Hidden WebView management
│   │   │   ├── api.rs                # WebView API call dispatch
│   │   │   └── poller.rs             # Poll player state from hidden WebView
│   │   │
│   │   ├── cache/
│   │   │   └── mod.rs                # Image/asset caching
│   │   │
│   │   ├── events/
│   │   │   ├── mod.rs
│   │   │   ├── bus.rs                # tokio::broadcast event bus
│   │   │   └── types.rs              # AppEvent enum
│   │   │
│   │   ├── integrations/
│   │   │   ├── mod.rs                # Integration trait + registry
│   │   │   ├── media_controls.rs     # OS media keys + Now Playing
│   │   │   ├── notifications.rs      # Track change notifications
│   │   │   └── global_shortcuts.rs   # Global hotkeys
│   │   │
│   │   ├── tray/
│   │   │   └── mod.rs                # System tray + Dock menu
│   │   │
│   │   └── logging/
│   │       └── mod.rs                # Structured tracing setup
│   │
│   └── icons/
│
└── scripts/
    └── inject/
        ├── ytm-player-bridge.js      # JS injected into hidden WebView
        └── ytm-compat.js             # YTM compatibility shims
```

---

## 5. Core Data Models

### Rust — Shared Types

```rust
// src-tauri/src/state/player.rs

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrackInfo {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<String>,
    pub album: String,
    pub album_id: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackStatus { Playing, Paused, Buffering, Idle }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepeatMode { None, One, All }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountInfo {
    pub name: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerState {
    pub status: PlaybackStatus,
    pub track: Option<TrackInfo>,
    pub position_secs: f64,
    pub volume: f64,
    pub is_liked: bool,
    pub repeat_mode: RepeatMode,
    pub is_shuffled: bool,
    pub queue: Vec<TrackInfo>,
    pub account: Option<AccountInfo>,
    pub logged_in: Option<bool>,
}

pub type SharedPlayerState = Arc<RwLock<PlayerState>>;
```

### Rust — YTM API Types

```rust
// src-tauri/src/ytm_api/types.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub songs: Vec<TrackInfo>,
    pub albums: Vec<AlbumSummary>,
    pub artists: Vec<ArtistSummary>,
    pub playlists: Vec<PlaylistSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumSummary {
    pub browse_id: String,
    pub title: String,
    pub artist: String,
    pub artwork_url: String,
    pub year: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumDetail {
    pub browse_id: String,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<String>,
    pub artwork_url: String,
    pub year: Option<String>,
    pub tracks: Vec<TrackInfo>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistSummary {
    pub channel_id: String,
    pub name: String,
    pub avatar_url: String,
    pub subscriber_count: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistDetail {
    pub channel_id: String,
    pub name: String,
    pub avatar_url: String,
    pub description: Option<String>,
    pub top_songs: Vec<TrackInfo>,
    pub albums: Vec<AlbumSummary>,
    pub singles: Vec<AlbumSummary>,
    pub similar_artists: Vec<ArtistSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistSummary {
    pub playlist_id: String,
    pub title: String,
    pub artwork_url: String,
    pub track_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shelf {
    pub title: String,
    pub items: ShelfItems,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ShelfItems {
    Albums(Vec<AlbumSummary>),
    Playlists(Vec<PlaylistSummary>),
    Songs(Vec<TrackInfo>),
    Artists(Vec<ArtistSummary>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lyrics {
    pub lines: Vec<LyricLine>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricLine {
    pub text: String,
    pub start_time_ms: Option<u64>,
}
```

### TypeScript — Mirror Types

```typescript
// src/lib/types.ts

export interface TrackInfo {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  artworkUrl?: string;
  durationSecs: number;
}

export interface AccountInfo {
  name: string;
  avatarUrl: string;
}

export interface PlayerState {
  status: 'playing' | 'paused' | 'buffering' | 'idle';
  track: TrackInfo | null;
  positionSecs: number;
  volume: number;
  isLiked: boolean;
  repeatMode: 'none' | 'one' | 'all';
  isShuffled: boolean;
  queue: TrackInfo[];
  account: AccountInfo | null;
  loggedIn: boolean | null;
}

export interface SearchResults {
  songs: TrackInfo[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
}

// ... (AlbumSummary, ArtistSummary, etc. mirror Rust types)
```

---

## 6. IPC Contract — Commands

Every Tauri command the React UI can call:

### Player Commands

```typescript
// src/lib/ipc.ts

export const playerApi = {
  play:       ()                    => invoke('play'),
  pause:      ()                    => invoke('pause'),
  togglePlay: ()                    => invoke('toggle_play'),
  next:       ()                    => invoke('next_track'),
  previous:   ()                    => invoke('previous_track'),
  seek:       (secs: number)        => invoke('seek', { secs }),
  setVolume:  (level: number)       => invoke('set_volume', { level }),
  like:       ()                    => invoke('toggle_like'),
  setRepeat:  (mode: RepeatMode)    => invoke('set_repeat', { mode }),
  shuffle:    ()                    => invoke('toggle_shuffle'),
  playTrack:  (videoId: string)     => invoke('play_track', { videoId }),
  playAlbum:  (browseId: string)    => invoke('play_album', { browseId }),
  addToQueue: (videoId: string)     => invoke('add_to_queue', { videoId }),
  getLoginState: () => invoke<boolean | null>('get_login_state'),
  getAccountInfo: () => invoke<AccountInfo | null>('get_account_info'),
};
```

### Browse Commands

```typescript
export const browseApi = {
  search:       (query: string)       => invoke<SearchResults>('search', { query }),
  getHome:      ()                    => invoke<Shelf[]>('get_home'),
  getAlbum:     (browseId: string)    => invoke<AlbumDetail>('get_album', { browseId }),
  getArtist:    (channelId: string)   => invoke<ArtistDetail>('get_artist', { channelId }),
  getPlaylist:  (playlistId: string)  => invoke<PlaylistDetail>('get_playlist', { playlistId }),
  getExplore:   ()                    => invoke<Shelf[]>('get_explore'),
  getLyrics:    (videoId: string)     => invoke<Lyrics>('get_lyrics', { videoId }),
  searchSuggestions: (query: string) => invoke<string[]>('search_suggestions', { query }),
  savePlaylistToLibrary: (playlistId: string) => invoke('save_playlist_to_library', { playlistId }),
  removePlaylistFromLibrary: (playlistId: string) => invoke('remove_playlist_from_library', { playlistId }),
  // Returns `true` when YTM actually added the track, `false` when YTM
  // deduped it (track was already in the playlist). UI surfaces the two
  // outcomes as distinct toasts.
  addTrackToPlaylist: (playlistId: string, videoId: string) =>
    invoke<boolean>('add_track_to_playlist', { playlistId, videoId }),
  // `setVideoId` is YTM's per-row id (carried on TrackInfo by the playlist
  // parser). Both ids are required — `removedVideoId` alone can't address
  // duplicate occurrences of the same video.
  removeTrackFromPlaylist: (
    playlistId: string, setVideoId: string, videoId: string,
  ) => invoke('remove_track_from_playlist', { playlistId, setVideoId, videoId }),
  createPlaylist: (
    title: string, description: string, privacy: PlaylistPrivacy, seedVideoId: string | null,
  ) => invoke<string>('create_playlist', { title, description, privacy, seedVideoId }),
  deletePlaylist: (playlistId: string) => invoke('delete_playlist', { playlistId }),
};
```

### Library Commands

```typescript
export const libraryApi = {
  getPlaylists: ()  => invoke<PlaylistSummary[]>('get_library_playlists'),
  getLikedSongs: () => invoke<TrackInfo[]>('get_liked_songs'),
  getAlbums:    ()  => invoke<AlbumSummary[]>('get_library_albums'),
  getArtists:   ()  => invoke<ArtistSummary[]>('get_library_artists'),
};
```

### Cache Commands

```typescript
export const cacheApi = {
  fetchImage: (url: string) => invoke<string>('cache_fetch_image', { url }),
  clear: () => invoke('cache_clear'),
  stats: () => invoke<CacheStats>('cache_stats'),
  convertToAssetUrl: (path: string) => convertFileSrc(path, 'cache-asset'),
};
```

### Settings Commands

```typescript
export const settingsApi = {
  get: () => invoke<AppSettings>('get_settings'),
  set: (settings: AppSettings) => invoke('set_settings', { settings }),
};
```

### Events (Rust → React)

```typescript
// Events the React UI listens to
export const EVENTS = {
  PLAYER_STATE_CHANGED: 'player:state-changed',  // full PlayerState
  TRACK_CHANGED:        'player:track-changed',   // TrackInfo
  POSITION_UPDATED:     'player:position',         // number (secs)
  VOLUME_CHANGED:       'player:volume',           // number (level)
  STATUS_CHANGED:       'player:status',           // PlaybackStatus
  LOGIN_CHANGED:        'player:login-changed',    // boolean
  ACCOUNT_CHANGED:      'player:account-changed',  // AccountInfo | null
} as const;
```

---

## 7. Event Bus (unchanged from previous design)

```rust
// src-tauri/src/events/bus.rs
pub struct EventBus {
    sender: broadcast::Sender<AppEvent>,
}

impl EventBus {
    pub fn new() -> Self { /* ... */ }
    pub fn emit(&self, event: AppEvent) {
        tracing::debug!(event = ?event, "event_bus::emit");
        let _ = self.sender.send(event);
    }
    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.sender.subscribe()
    }
}
```

---

## 8. Integration Trait (unchanged)

```rust
#[async_trait]
pub trait Integration: Send + Sync + 'static {
    fn name(&self) -> &'static str;
    async fn start(&self, bus: Arc<EventBus>, state: SharedPlayerState, app: AppHandle) -> Result<()>;
    async fn stop(&self) -> Result<()>;
    fn is_enabled(&self, settings: &AppSettings) -> bool;
}
```

Integrations: `media_controls`, `notifications`, `global_shortcuts` — each listens to the event bus and reacts independently.

---

## 9. Design Tokens

> **DEPRECATED — see §0 Design System Cheatsheet (top of this file) for the
> current token values.** The block below was the original token plan when
> this design doc was written; it has since drifted from `src/styles/tokens.css`
> (e.g. `--text-2xl` is 28px in code, not 32px as listed below). Treat this
> section as historical context only. The cheatsheet at §0 is the canonical
> visual reference; `tokens.css` is the runtime source of truth.

```css
/* src/styles/tokens.css */
:root {
  /* === Surfaces (3-level elevation) === */
  --color-bg:              oklch(10% 0.015 270);     /* deepest background */
  --color-surface-1:       oklch(14% 0.015 270);     /* sidebar, player bar */
  --color-surface-2:       oklch(18% 0.012 270);     /* cards, hover states */
  --color-surface-3:       oklch(22% 0.010 270);     /* elevated: modals, menus */

  /* === Text === */
  --color-text-primary:    oklch(95% 0 0);
  --color-text-secondary:  oklch(65% 0 0);
  --color-text-tertiary:   oklch(45% 0 0);

  /* === Accent (dynamic — overridden by album art color) === */
  --color-accent:          oklch(65% 0.20 25);       /* default red, overridden per track */
  --color-accent-subtle:   oklch(25% 0.08 25);       /* tinted backgrounds */

  /* === Semantic === */
  --color-border:          oklch(25% 0.005 270);
  --color-highlight:       oklch(30% 0.010 270);     /* hover rows */
  --color-danger:          oklch(60% 0.22 25);

  /* === Glass effect === */
  --glass-bg:              oklch(14% 0.015 270 / 0.7);
  --glass-blur:            20px;
  --glass-border:          oklch(30% 0.005 270 / 0.3);

  /* === Typography === */
  --font-sans:             -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  --font-mono:             'SF Mono', ui-monospace, monospace;

  --text-xs:               0.6875rem;    /* 11px — metadata */
  --text-sm:               0.8125rem;    /* 13px — secondary text */
  --text-base:             0.9375rem;    /* 15px — body */
  --text-lg:               1.125rem;     /* 18px — section headers */
  --text-xl:               1.5rem;       /* 24px — page titles */
  --text-2xl:              2rem;         /* 32px — hero / now playing */

  --font-weight-regular:   400;
  --font-weight-medium:    500;
  --font-weight-semibold:  600;
  --font-weight-bold:      700;

  /* === Spacing (4px base) === */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* === Layout === */
  --sidebar-width:          240px;
  --sidebar-collapsed:      64px;
  --now-playing-width:      320px;
  --player-bar-height:      72px;
  --title-bar-height:       38px;

  /* === Radius === */
  --radius-sm:  6px;
  --radius-md:  10px;
  --radius-lg:  14px;
  --radius-xl:  20px;
  --radius-full: 9999px;

  /* === Shadows === */
  --shadow-sm:  0 1px 2px oklch(0% 0 0 / 0.3);
  --shadow-md:  0 4px 12px oklch(0% 0 0 / 0.4);
  --shadow-lg:  0 8px 24px oklch(0% 0 0 / 0.5);

  /* === Motion === */
  --duration-fast:    100ms;
  --duration-normal:  200ms;
  --duration-slow:    400ms;
  --ease-out:         cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1);

  /* === Album grid === */
  --grid-card-min:    160px;
  --grid-gap:         var(--space-5);
}
```

### Glass Effect Utility

```css
/* src/styles/glass.css */
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.4);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.4);
  border: 1px solid var(--glass-border);
}

.glass-sidebar {
  background: oklch(12% 0.015 270 / 0.6);
  backdrop-filter: blur(30px) saturate(1.5);
  -webkit-backdrop-filter: blur(30px) saturate(1.5);
}
```

---

## 10. Component Sketches

### PlayerBar

```tsx
// src/components/layout/PlayerBar.tsx
// Fixed at bottom. Three sections:

// Left: artwork thumbnail (48x48) + song title + artist (clickable → artist page)
// Center: transport controls (shuffle, prev, play/pause, next, repeat) + progress bar
// Right: like button, volume slider, queue toggle, now-playing toggle

// Background tints using dominant color from current album art
// Height: var(--player-bar-height) = 72px
```

### AlbumCard

```tsx
// src/components/browse/AlbumCard.tsx
// Square artwork with rounded corners (--radius-lg)
// On hover: slight scale (1.02) + play button overlay (centered, semi-transparent circle)
// Below artwork: album title (medium weight, truncate 1 line) + artist (secondary color, truncate)
// Click → navigate to AlbumDetailPage
// Right-click → context menu (play, add to queue, go to artist)
```

### Sidebar

```tsx
// src/components/layout/Sidebar.tsx
// Glass background effect
// Top section: Home, Search, Explore (with icons)
// Divider
// LIBRARY section: Playlists, Songs, Albums, Artists
// Divider
// PINNED section: user-pinned playlists (drag to pin)
// Active item: accent color highlight, bold text
// Width: var(--sidebar-width) = 240px
// macOS: accounts for title bar drag region at top
```

### NowPlaying (Right Sidebar)

```tsx
// src/components/player/NowPlaying.tsx
// Toggleable right panel (var(--now-playing-width) = 320px)
// Top: large artwork (fills width, rounded corners)
// Below artwork: title (xl), artist (lg, clickable), album (sm, clickable)
// Progress: current time / duration
// Lyrics section (collapsible): synced lyrics with current line highlighted
// Queue section: draggable list of upcoming tracks
// Background: subtle tint from album art dominant color
```

---

## 11. Authentication Flow

```
1. First launch → show "Sign in to YouTube Music" screen
2. Open hidden WebView → navigate to accounts.google.com
3. User logs in (we show this WebView temporarily, full-size)
4. After login redirect to music.youtube.com
5. Extract cookies + auth headers from WebView
6. Store auth tokens securely (tauri-plugin-store, encrypted)
7. Hide the WebView, show custom React UI
8. For subsequent launches, inject stored cookies into hidden WebView
9. If cookies expire → re-show login WebView
```

---

## 12. Feature Implementation Map

### Phase 1 — Skeleton (Days 1-4)

| Task | Details |
|------|---------|
| Init Tauri 2.x + React + Vite | Project scaffold |
| AppShell layout | Sidebar + content + player bar (static) |
| Hidden WebView | Load music.youtube.com, inject JS bridge |
| Auth flow | Google login in WebView, cookie extraction |
| Basic playback | Play a track by video ID, JS bridge reports state |
| PlayerBar | Shows track info, play/pause works |

### Phase 2 — Browse & Library (Days 5-9)

| Task | Details |
|------|---------|
| YTM API client | Implement search, home, album, artist, playlist endpoints |
| HomePage | Shelves with album/playlist grids |
| SearchPage | Debounced search, categorized results |
| AlbumDetailPage | Track list, play album |
| ArtistDetailPage | Top songs, discography |
| Library pages | Playlists, liked songs, albums, artists |

### Phase 3 — Player Polish (Days 10-13)

| Task | Details |
|------|---------|
| Queue management | View, reorder, clear queue |
| NowPlaying sidebar | Large artwork, lyrics, queue |
| Lyrics | Fetch + display synced lyrics |
| Album art color extraction | Dynamic accent color in player bar + now playing |
| Progress bar seeking | Click/drag to seek |
| Volume control | Slider with mute toggle |
| Keyboard shortcuts | Space=play/pause, arrows=seek, etc. |

### Phase 4 — OS Integration (Days 14-17)

| Task | Details |
|------|---------|
| Media keys + Now Playing | `tauri-plugin-media` integration |
| System tray | Tray icon with playback controls menu |
| Track notifications | Desktop notification on track change |
| Global shortcuts | Configurable global hotkeys |
| Background playback | Keep playing when window closes (tray) |
| Dock menu | Playback controls in Dock right-click |

### Phase 5 — Integrations (Days 18-21)

| Task | Details |
|------|---------|
| Custom CSS injection | User can apply custom styles to the UI |
| Ad blocking | JS injection in hidden WebView |
| URL scheme | `vibeytm://play?v=VIDEO_ID` |

### Phase 6 — Release (Days 22-25)

| Task | Details |
|------|---------|
| Mini player mode | Small floating window |
| Settings page | All integration configs, shortcuts, appearance |
| Auto-updater | `tauri-plugin-updater` with GitHub releases |
| App icon | Design and generate all sizes |
| Homebrew cask | `brew install vibeytm` |
| CI/CD | GitHub Actions for cross-platform builds |
| README + screenshots | Documentation |

---

## 12a. Future Roadmap

Post-1.0 feature roadmap. Ordered roughly by user value × implementation cost.
All features must preserve the single-source-of-truth invariant: `PlayerState`
in Rust remains the only authoritative playback state; new surfaces subscribe
to the existing event bus rather than polling the YTM WebView independently.

### Tier 1 — Requested (commit)

#### Login Optimization (M)

The current flow (§11) requires the user to click "Show YouTube Music",
log in inside the raw YTM window, then click "Done" to tell the app they're
finished. That manual handshake is the single roughest edge on first run and
on cookie expiry.

- **Auto-detect login:** Poll `document.cookie` / check for the `SAPISID`
  cookie on the YTM WebView from Rust. As soon as the authenticated cookie
  set appears, fire a `auth:logged_in` event on the bus and auto-hide the
  YTM window. The "Done" button disappears entirely.
- **Direct navigation:** Open the hidden window straight to
  `https://accounts.google.com/ServiceLogin?service=youtube&continue=https://music.youtube.com`
  instead of `music.youtube.com` + manual click-through. Saves 2–3 clicks.
- **Session restore:** On launch, probe YTM headless first. Only surface the
  login UI if the probe returns unauthenticated. Today every launch shows
  the login page briefly until state hydrates — this removes that flicker.
- **Graceful re-auth:** When cookies expire mid-session, surface a toast
  ("Your YouTube Music session expired — sign in to continue") that opens
  the YTM window inline instead of bouncing the user back to the full login
  page and losing scroll position / queue context.
- **Guest / browse-only mode:** Allow browsing public YTM content (search,
  explore) without logging in. Library / playback stays gated but the app
  becomes usable immediately on first launch for the "just trying it" path.
- **Secure storage hardening:** Today auth is persisted via
  `tauri-plugin-store`. Migrate the sensitive cookie blob to the macOS
  Keychain (`security-framework` crate) so it's not plaintext on disk.

Success metric: first-launch time from app open to "I can play a song"
drops below 15 seconds for a user with an existing Google session in
Safari/Chrome.

#### Themes (L)

Pluggable visual themes on top of the existing design tokens (§9). Ship with
Light, Dark (default), and a "Dynamic" mode that extracts accent from current
artwork.

- **Token layer:** All color usage already routes through CSS custom
  properties in §9. A theme is just a `:root[data-theme="…"]` override block.
- **Storage:** `app_settings.theme: "light" | "dark" | "dynamic" | "<custom>"`
  persisted via `tauri-plugin-store`. Settings page exposes a picker.
- **Dynamic mode:** Reuse the album-art color extraction planned for §12
  Phase 3; apply extracted hue to `--color-accent` on track change with a
  300ms crossfade.
- **Custom themes:** User-authored JSON in `~/Library/Application Support/VibeYTM/themes/*.json`.
  A theme declares only token overrides — never arbitrary CSS — so the
  attack surface stays zero.
- **System sync:** `prefers-color-scheme` listener toggles between the user's
  chosen light and dark themes when "System" is selected.

#### Focus Mode (M)

A Pomodoro-style countdown timer embedded in the NowPlaying page, inspired by
the Focus app on macOS. Used for study / deep-work sessions.

- **UI:** Circular progress ring overlaid on the album art on NowPlaying.
  Presets: 25/50/90 min, plus custom. Start/pause/reset controls under the
  playback transport.
- **Behavior:**
  - Countdown runs in Rust (`tokio::time::interval`) so the UI can close
    without losing state.
  - On expiry: pause playback, show a non-intrusive notification, optionally
    play a soft chime (separate `<audio>` element in the React window — not
    routed through the YTM engine).
  - Optional "strict mode": disables tab switching (sidebar click handlers
    gated) and mutes notifications until the timer ends.
- **State:** New `FocusSession { started_at, duration_ms, status }` in Rust,
  emitted on the event bus as `focus:tick` / `focus:complete`. Does not touch
  `PlayerState`.
- **Stats:** Persist completed sessions to SQLite for a future "focus history"
  view. Defer the history UI until someone asks.

#### Lyrics (M)

Synced lyrics display on the NowPlaying page and as an optional overlay on
the PlayerBar.

- **Source order:**
  1. YTM's own lyrics endpoint (`browse` with lyrics tab param) — already
     accessible via `ytm_api`, no new auth.
  2. LRCLIB (free, open, synced `.lrc` format) as fallback.
  3. Musixmatch / Genius — deferred; licensing friction.
- **Format:** Normalize to `Vec<LyricLine { time_ms, text }>`; if the source
  is unsynced, fall back to scrolling plain text.
- **Sync:** The existing 250ms `player:tick` event drives the active-line
  highlight. No new polling.
- **Cache:** Reuse the disk cache (§ `cache` module) keyed by `video_id`, 30-day
  TTL. Image cache and lyric cache share eviction logic.
- **Translate:** Optional "show translation" toggle (English → user locale)
  via a local on-device model is a deferred stretch goal.

### Tier 2 — High ROI follow-ups

Researched against th-ch/youtube-music, Cider, Feishin, Spotify, and Apple
Music. All are clean fits for the wrapper architecture (we don't own the
catalog or audio engine, so features that require either are Tier 3).

| # | Feature | Difficulty | Value | Notes |
|---|---------|------------|-------|-------|
| 1 | Discord Rich Presence | L | High | `discord-rich-presence` Rust crate, subscribe to `player:track` events. Toggle in settings. |
| 2 | Last.fm / ListenBrainz scrobbling | L | High | HTTP POST on track-change; OAuth handled in a Tauri window. Core power-user feature. |
| 3 | macOS Now Playing / media keys | M | Critical | Already planned Phase 4. Bumped to roadmap because without it the app doesn't feel native. MediaRemote framework via `objc2`. |
| 4 | SponsorBlock for music | M | High | Hidden-WebView JS injection seeks past non-music segments. Most-praised th-ch/youtube-music plugin. Requires content warning in settings. |
| 5 | Mini player window | L | High | Second Tauri window, subset of React UI, reuses existing event bus. Always-on-top floating player. |
| 6 | Customizable keyboard shortcuts | L | Medium | `tauri-plugin-global-shortcut` + settings UI. Basic shortcuts planned Phase 3; customization is the delta. |
| 7 | Playback history (local) | L | Medium | `rusqlite`, SQLite in app data dir. Track plays independently of YTM's own history. Enables the Focus stats view and future smart queue. |
| 8 | Sleep timer | L | Medium | Sibling of Focus Mode — pause-after-N-minutes with optional fade-out. Shares timer infrastructure. |
| 9 | Play on launch / resume | L | Medium | Restore queue + position on app start. Requires persisting `PlayerState` snapshot on graceful shutdown. |
| 10 | Cross-fade between tracks | H | Medium | Deferred: we don't own the audio engine. Would require dual hidden WebViews or WebAudio interception. Prototype only. |

### Tier 3 — Deferred / uncertain

- **Audio EQ + loudness normalization:** WebAudio injection into hidden YTM
  view; YTM actively resists tampering. High risk, high maintenance.
- **Offline download cache (yt-dlp sidecar):** Legally gray, platform TOS
  friction. Reconsider only if VibeYTM goes fully self-hosted.
- **Plugin system:** Only worth building once ≥3 real integrations exist and
  are stable. Premature abstraction otherwise.
- **Lyric translation (on-device):** Waits for a small enough model to ship
  without bloating the DMG past 150 MB.

### Sequencing principle

Every roadmap item must either (a) subscribe to the existing event bus, or
(b) introduce new Rust state that is orthogonal to `PlayerState`. No feature
is allowed to poll the YTM WebView directly — the bridge is the sole reader.
This keeps the architecture invariants from §1 intact as the surface grows.

---

## 13. Debuggability

### Structured Logging

```rust
tracing::info!(command = "search", query = %query, results = results.songs.len(), "search completed");
tracing::debug!(event = ?event, "event_bus::emit");
tracing::warn!(integration = "notifications", error = %e, "failed to send notification");
```

Logs to: file (`~/Library/Logs/VibeYTM/`), terminal (`tauri dev`), and in-app EventInspector.

### Event Inspector (`Cmd+Shift+D`)

- Real-time event stream with timestamps and JSON payloads
- Filter by event type (player, integration, error)
- Current `PlayerState` snapshot
- Hidden WebView health (last bridge poll, error count)
- Integration status dashboard

### Error Recovery

- **Failed integration** → logged + disabled, app continues
- **Hidden WebView crash** → detected, auto-restart WebView
- **Auth expiry** → detected, re-show login WebView
- **API error** → show inline error in UI, retry with backoff

---

## 14. Key Dependencies

### Rust

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-log = "2"
tauri-plugin-store = "2"
tauri-plugin-notification = "2"
tauri-plugin-global-shortcut = "2"
tauri-plugin-shell = "2"
tauri-plugin-deep-link = "2"
tauri-plugin-updater = "2"
tauri-plugin-media = "0.1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
tracing = "0.1"
tracing-subscriber = "0.3"
async-trait = "0.1"
reqwest = { version = "0.12", features = ["json", "cookies"] }
```

### Frontend

```json
{
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "react-router": "^7",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-store": "^2",
    "@tauri-apps/plugin-notification": "^2",
    "@tauri-apps/plugin-log": "^2"
  },
  "devDependencies": {
    "vite": "^6",
    "@vitejs/plugin-react": "^4",
    "typescript": "^5"
  }
}
```

---

## 15. Why React is Now Justified

In the previous design (wrapping YTM's UI), React was overkill. Now we're building a **full custom UI** with:

- 10+ distinct pages/views with routing
- Complex state management (player, library, search, queue)
- Reusable component library (cards, lists, grids, controls)
- Dynamic theming (album art color extraction)
- Keyboard navigation and accessibility

This is a real frontend application, not a settings panel. React + TypeScript gives us:
- Component composition for the album grids, song lists, player controls
- Hooks for clean state subscription (`usePlayerState`, `useSearch`)
- Type safety across the IPC boundary (TypeScript types mirror Rust structs)
- Fast dev iteration with Vite HMR

**No additional CSS framework** — we use CSS custom properties + plain CSS. No Tailwind, no styled-components. Keeps the bundle small and the design intentional.

---

## 16. Testing Strategy

| Layer | Tool | What to Test |
|-------|------|-------------|
| Rust unit | `cargo test` | State transitions, YTM API parsing, event bus |
| Rust integration | `cargo test --test` | Command handlers with mock state |
| Frontend unit | Vitest | Hooks, IPC wrappers, color extraction |
| Frontend component | Vitest + Testing Library | AlbumCard, PlayerBar, SongRow rendering |
| E2E | Playwright + Tauri WebDriver | Full app flows: search → play → queue |
| Visual regression | Playwright screenshots | Key views at different states |

---

## 17. Security

- WebView navigation locked to `music.youtube.com` and `accounts.google.com`
- Auth cookies stored encrypted via `tauri-plugin-store`
- No arbitrary JS execution from user input
- All IPC commands explicitly allowlisted in capabilities
- No file system access from frontend
- Account display name is never written to Rust log files; the bridge→Rust
  debug pipe is gated behind `#[cfg(debug_assertions)]` so release builds
  never surface diagnostic strings to disk

---

## 18. Changes Since v0.1.0

Running history of design-affecting changes delivered after the initial release.
Minor bug fixes that don't alter the contracts documented above are omitted —
see `git log` for the exhaustive list.

### v0.2.0 — Stability & UX fixes

- **Disk-backed cache** (`src-tauri/src/cache`) for images and track duration
  metadata so scrolling the library doesn't re-hit the YTM CDN and so durations
  survive across shelves that don't ship them.
- **Search flow rework**: suggestions are debounced, results are cached per
  query, album top-hit previews are lazy-fetched from the playlist endpoint.
- **Now Playing page** with queue, shuffle/repeat controls, and artwork-derived
  accent color.
- **Security hardening + test suite**: Tauri capability allowlist tightened,
  YTM-ID validation for navigation commands, first batch of `cargo test`
  coverage over `ytm_api`, `cache`, and `webview_bridge`.
- **v0.2.0 issue-fix pass** (13 open issues) landed assorted UX polish:
  shortcut handling, home-tab state retention, explore reload on first open,
  search-tab sub-tab completeness.
- **Release process**: builds now always produce a macOS DMG, attached to the
  GitHub release. Documented in `CLAUDE.md`.

### Post-0.2.0 — Player bar alignment & sidebar account (this branch)

- **Player bar alignment**: `PlayerBar` is no longer full-width. It starts at
  `left: var(--sidebar-width)` so it sits under the main content area only.
  The sidebar continues to occupy its full height, which in turn allows a
  bottom-of-sidebar surface for user account info.

- **Sidebar account card**: A new row at the bottom of the sidebar shows the
  signed-in account's display name and profile picture. Implementation:

  ```
  scripts/inject/ytm-player-bridge.js
    ├── readAvatarFromDom()       — nav-bar img.src → 96px thumbnail URL
    ├── readSapisidCookie()       — pulls __Secure-3PAPISID / SAPISID
    ├── sapisidHash(sapisid, origin)
    │     SAPISIDHASH <ts>_<sha1(ts + " " + sapisid + " " + origin)>
    │   (reverse-engineered by ytmusicapi; YouTube's own frontend protocol)
    └── fetchAccountFromApi()
          POST /youtubei/v1/account/account_menu?key=<INNERTUBE_API_KEY>
          headers:  Authorization: SAPISIDHASH ...
                    X-Origin: https://music.youtube.com
                    X-Goog-AuthUser: 0
          body:     { "context": INNERTUBE_CONTEXT }
          Walks actions[0].openPopupAction.popup.multiPageMenuRenderer
                   .header.activeAccountHeaderRenderer for accountName.runs +
                   accountPhoto.thumbnails
  ```

  Rust-side flow mirrors the existing poller pattern:

  1. `BridgeState.account: Option<BridgeAccount>` added to the poller's
     eval payload.
  2. Poller diffs against `last_account`; on change, emits
     `player:account-changed` and writes `AccountInfo` into `PlayerState`.
  3. Frontend hook `useAccountInfo()` reads initial state via a new
     `get_account_info` IPC command and subscribes to the event for live
     updates.

  **Why the SAPISIDHASH header matters**: without it, YTM's `account_menu`
  response collapses to generic `compactLinkRenderer` entries (Settings,
  Premium, Help) and omits `activeAccountHeaderRenderer` entirely. This was
  the blocker that forced experimentation with the avatar DOM and a
  click-and-scrape fallback before arriving at the documented API call.

- **Progress bar resilience**: YTM occasionally reports `duration = 0` during
  the first poll cycles of a new track. The old code locked the slider value
  against `max = duration || 1` with an unclamped `value = positionSecs`,
  which pinned the thumb at 100% until the next track change. Fixes:
  - Poller re-emits the track via `player:track-changed` when duration
    becomes non-zero on a subsequent cycle, even if the video ID hasn't
    changed.
  - `PlayerBar` clamps `value` to `0` while `duration === 0` so the thumb
    stays at the start regardless of backend lag.

- **Hover affordances** in the player bar: transport buttons (shuffle, prev,
  play, next, repeat), album thumbnail, like button, and now-playing toggle
  all scale up on `mouseenter` and return to 1× on `mouseleave`. Kept via
  inline `onMouseEnter`/`onMouseLeave` (current codebase convention — see
  §10 PlayerBar sketch) rather than adding a global `:hover` rule.

- **Data-model additions**:
  - `AccountInfo { name: String, avatar_url: String }` — serialized as
    camelCase (`avatarUrl`) to match the frontend type.
  - `PlayerState.account: Option<AccountInfo>`.
  - Frontend `AccountInfo` interface in `src/lib/types.ts` mirrors the Rust
    struct 1:1.

- **Security**:
  - `tracing::info!` for account updates logs `has_name=bool` /
    `has_avatar=bool` — never the display name itself.
  - The entire bridge→Rust debug pipe (ring of recent `log()` lines from
    the bridge script) is gated behind `#[cfg(debug_assertions)]`. Release
    builds drop the code paths entirely.

- **Test additions**:
  - Unit: `state::player::tests` (4 tests) — `AccountInfo` camelCase serde,
    equality, `PlayerState` default, serialization with account.
  - Unit: `webview_bridge::poller::tests` (6 tests) — `BridgeState`
    parses with/without account, missing-field defaults, account equality
    for change detection, `parse_repeat` fallthrough, debug vec parsing.
  - Integration: `src-tauri/tests/account_info_integration.rs` (3 tests) —
    locks the wire contract between the bridge JS, Rust poller, and
    frontend `AccountInfo` type.

### v0.9.0 — Lyrics pipeline, karaoke UI, reload polish

- **Three-tier timed lyrics fallback**:
  1. YTM's own timed lyrics from
     `contents.elementRenderer.newElement.type.componentType.model.timedLyricsModel.lyricsData.timedLyricsData`
     when available.
  2. Parallel race of LRCLIB and NetEase via `tokio::select!` —
     `fetch_lrclib_synced` against `https://lrclib.net/api/get` and
     `fetch_netease_synced` against `music.163.com` (search → `song/lyric`).
     First `Some(data)` wins; `None` results wait for the other. LRCLIB
     covers Western catalog, NetEase covers Mandopop/CJK.
  3. Plain text with evenly-distributed synthetic timings so the panel
     still scrolls when neither source has synced lines.
  The external fallbacks run only when YTM confirmed lyrics exist; a
  `messageRenderer: "Lyrics not available"` short-circuits so
  instrumentals don't get the vocal original's lyrics pasted onto them.

- **YTM request context upgrade**: `webview_bridge::api::ytm_api_call`
  now reads `window.ytcfg.get('INNERTUBE_CONTEXT')` and
  `INNERTUBE_API_KEY` from inside the YTM webview, replacing the
  hand-crafted 4-field context. Adds `X-YouTube-Client-Name: 67` and
  `X-YouTube-Client-Version` headers, plus `&key=<api_key>` on the URL —
  matching what YTM web sends and unlocking Elements-rendered responses
  the minimal context missed.

- **Persistent lyrics cache** at `{app_data}/cache/lyrics/{videoId}.json`
  alongside `tracks/` and `images/`. `Cache::get_lyrics` / `put_lyrics`
  methods, 7-day + jitter TTL, included in `Cache::clear`. Only content-
  bearing results are persisted; empty stubs and transient errors stay
  un-cached so a future probe can still populate them.

- **In-memory cache + de-dupe** (`src/hooks/useLyrics.ts`): shared
  `lyricsCache` and `lyricsMisses` maps keyed by videoId, plus an
  `inFlight` promise map so `PlayerBar` (pre-probe) and `NowPlaying`
  (on-demand) share the same fetch. Single-retry after 1.5 s on
  transient error handles webview-navigation races.

- **Pre-fetch + upcoming-queue preload**: `PlayerBar` calls
  `useLyrics(track, true, true)` so the fetch starts the instant a track
  loads. Separately, new `get_upcoming_tracks(video_id, limit)` command
  parses YTM's upcoming queue from `playlistPanelRenderer.contents`
  (handles both the direct `playlistPanelVideoRenderer` form and the
  newer `playlistPanelVideoWrapperRenderer.primaryRenderer` wrap), then
  fires `preloadLyrics` on the first two results so skipping forward
  usually hits cache.

- **Karaoke UI** (`NowPlaying` + `LyricLineView`): each line renders as
  two stacked copies — a base at the title color and an absolute overlay
  in the same color with `clip-path: inset(0 (1-progress)*100% 0 0)`
  revealing left-to-right as the vocal advances. Container auto-scrolls
  to keep the active line centered; first scroll per visibility session
  is instant (`behavior: 'auto'`), subsequent advances are smooth. First
  scroll waits 450 ms after the panel opens so the column's width
  transition has settled before measuring.

- **Split playing-page layout**: single row used in both cover-only and
  lyrics-open modes. Lyrics column width animates `0` →
  `calc(coverSide / 2)` over 420 ms with `marginLeft` and `opacity` in
  sync, so toggling LRC is a smooth transition rather than a tree
  remount. Cover takes 2/3 of the 1200 px-capped row, lyrics 1/3; cover
  side length computed once and used identically in both modes so
  toggling never resizes it. Panel top-aligns with the sidebar's Home
  button via `paddingTop: var(--space-3)`.

- **LRC button**: always clickable. Pre-probe runs on every
  `track.videoId` change so state is ready before the user clicks. Dim
  opacity communicates "no lyrics" without disabling — the user can open
  the panel to see the "No lyrics for this track" message.

- **Blur-and-spinner reload pattern** (`src/components/LoadingOverlay.tsx`):
  new `<LoadingSpinner>` and `<ReloadOverlay>` primitives. Home, Explore,
  Library, PlaylistDetail, and Search now keep previously-rendered
  content visible with a 10 px blur + centered spinner while refetching,
  instead of wiping to a "Loading…" placeholder. First-load on each page
  still shows a bare spinner since there's nothing to blur.

- **Data-model additions**:
  - `Lyrics { text, source?, lines? }` and
    `LyricLine { startMs, endMs?, text }`, serialized camelCase; mirrored
    in TS `src/lib/types.ts`.
  - New commands: `get_lyrics(video_id, artist?, title?, duration_secs?)`,
    `get_upcoming_tracks(video_id, limit?)`.

### v0.9.2 — WKWebView click-target rule + interactive reload overlay

- **Card click target must be a real `<button>`** (`src/components/browse/AlbumCard.tsx`).
  An attempt to clean up nested-button HTML by switching the outer wrapper
  to `<div role="button" tabIndex={0}>` looked semantically equivalent
  and passed type-checking, but in this Tauri WKWebView build the
  synthetic React `onClick` was silently dropped on every card —
  `onMouseEnter`/`Leave` still fired, only the click event was lost.
  Verified with a diagnostic IPC ping (`cache_stats` invocation count
  stayed at zero across many clicks). Reverting the outer to `<button>`
  fixed it instantly. Codified in `CLAUDE.md` ("WKWebView quirks"
  section) and `TEST_CHECKLIST.md` ("WKWebView quirks — REGRESSION
  TRAPS"). **If you must avoid nested-button HTML, change the INNER
  element to `<span role="button" onClick={...}>`, never the outer.**

- **`ReloadOverlay` no longer blocks pointer events**
  (`src/components/LoadingOverlay.tsx`). The blur-the-children + spinner
  pattern from v0.9.0 placed `pointerEvents: 'none'` on the wrapper
  around the cached children. While intended to suppress interaction
  during reload, in practice it made every card on every page click-
  dead for the duration of any YTM bridge stall (~30 s during webview
  navigation). Replaced with a small corner-positioned spinner whose
  own `pointerEvents: 'none'` lets it sit non-interactively over fully
  clickable stale content — true stale-while-revalidate.

- **Background fetches debounced past YTM webview navigation**.
  YTM's hidden audio webview navigates on every track change, hanging
  in-flight `fetch()` calls inside it for ~3-15 s. Three background
  calls (PlayerBar's lyrics preprobe, PlayerBar's lyrics preload-for-
  next, QueuePanel's `get_upcoming_tracks`) all fired within ~2 ms of
  each track change and stacked up timing out simultaneously, starving
  the bridge channel and making user-driven IPCs (`get_playlist`,
  `search`) feel unresponsive. Added a 1.5-2 s settle delay on each.

- **PlayerBar lyrics preload reads `getPlannedNext()` first**
  (`src/components/layout/PlayerBar.tsx`). Replaces the per-track-change
  `getUpcomingTracks(currentVideoId, 2)` HTTP fetch with a synchronous
  read from the visible queue's published Up Next #1. Eliminates an
  extra `/next` round-trip and guarantees the preloaded lyrics match
  exactly what the user's Next-click will play.

- **7-day localStorage cache for browse data** (`src/lib/persistentCache.ts`).
  Home shelves, Explore shelves, and Library (playlists/songs/albums/
  artists) now persist their last-known-good payloads under
  `vibeytm:browse:v1:*`. `useState` initializers hydrate from
  localStorage so the grid renders with clickable cards before the
  network call returns — important on cold start when the bridge
  may be hanging through its first webview navigation.

- **Toggle-now-playing also clears LRC active state** (`src/App.tsx`).
  Closing the playing page via the cover-image button also flips
  `isLyricsOpen` to false, so the LRC button in the player bar drops
  its accent state in lockstep with the panel dismissing.
