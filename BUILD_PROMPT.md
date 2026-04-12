# VibeYTM — Full Build Specification

This is the complete specification for VibeYTM: a macOS desktop app that wraps
YouTube Music's playback engine in an Apple Music–style custom UI. Feed this
document to an AI agent and it should be able to build the app from scratch
without further human input, producing the same behaviour as the current
implementation.

---

## 1. Product Definition

### 1.1 What it is

- Native macOS desktop app.
- Uses a hidden YouTube Music WKWebView as the **audio engine** (to reuse YTM
  authentication, DRM, playback, and the full YTM catalog).
- Uses a visible React WKWebView as the **UI** — pixel-controlled Apple
  Music–style interface with sidebar nav, browse pages, now-playing overlay.
- The visible UI never embeds the YTM web player. It only renders its own
  components and drives the hidden YTM WebView via a JS bridge.

### 1.2 Core goals

- Feel like a native app, not a wrapped webpage. No YTM chrome visible.
- Play/pause/shuffle/repeat/like latency < 150 ms perceived.
- Covers never flash or paint half-loaded.
- Search, home, explore, library, playlist detail, now playing, settings.
- 1 GB on-disk cache (images + track metadata) with 7-day TTL and jittered
  expiration.
- Zero YTM login flow in our UI — user signs in once in the hidden YTM
  window.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2.x** | macOS-native window + WKWebView + sandboxing |
| Backend language | **Rust** (edition 2021) | Tauri-native, async via Tokio |
| Backend async | `tokio` (`sync`, `macros`, `rt-multi-thread`) | |
| YTM audio engine | Hidden **WKWebView** pointed at `https://music.youtube.com` with a Safari user agent (Google sign-in allows Safari, not Chrome-spoofed WebViews) | |
| JS ↔ Rust bridge | **ObjC2** (`objc2`, `objc2-web-kit`, `objc2-foundation`, `block2`) — not Tauri's IPC (YTM is cross-origin from the app, so normal IPC doesn't work on external URLs) | |
| HTTP | `reqwest` (for image fetching into the disk cache) | |
| Hashing | `sha2` + `hex` (cache keys) | |
| Logging | `tracing` + `tracing-subscriber` | |
| Error types | `anyhow` | |
| Frontend | **React 19** + **TypeScript** + **Vite** | |
| Frontend state | React hooks only; module-level caches for shared state | |
| Styling | Inline styles + CSS custom properties in `src/styles/tokens.css` + `global.css` | |
| Icons | Unicode characters (▶, ↻, ◄◄, etc.) — no icon font or SVG library | |
| Package manager | **pnpm** | |

No CSS framework. No component library. No state management library. No
router — `currentPath: string` + `viewingPlaylist: ViewingPlaylist | null`
in App state.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Tauri process                                          │
│  ┌───────────────────────┐   ┌──────────────────────┐   │
│  │  Main window (UI)     │   │  Hidden YTM window   │   │
│  │  WKWebView loads      │   │  WKWebView loads     │   │
│  │  Vite dev (or dist/)  │   │  music.youtube.com   │   │
│  │                       │   │  Safari UA           │   │
│  │  React app            │   │  + init script:      │   │
│  │                       │   │    ytm-compat.js     │   │
│  │                       │   │    ytm-player-       │   │
│  │                       │   │      bridge.js       │   │
│  └────┬──────────────────┘   └──────┬───────────────┘   │
│       │ Tauri invoke()              │                    │
│       │                             │ objc2              │
│       │                             │ evaluateJavaScript │
│       ▼                             ▼                    │
│  ┌───────────────────────────────────────────────────┐   │
│  │  Rust backend                                     │   │
│  │  - commands/ (Tauri command handlers)             │   │
│  │  - webview_bridge/ (JS eval + poller)             │   │
│  │  - ytm_api/ (YTM internal API parsers)            │   │
│  │  - cache/ (disk cache)                            │   │
│  │  - state/ (player state in Arc<RwLock>)           │   │
│  │  - events/ (tokio broadcast event bus)            │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Bridge and poller

The bridge is an **init script injected at hidden-window creation time** via
`WebviewWindowBuilder::initialization_script`. It runs on every navigation.
The bridge:

1. Waits for `#movie_player` to exist in the YTM DOM.
2. Every 150 ms, reads playback state (title, artist, position, duration,
   status, volume, shuffle, repeat, like-status, videoId, artworkUrl) and
   writes it to `window.__VIBEYTM_STATE__`.
3. Exposes `window.__VIBEYTM_COMMAND__(cmd, args)` which dispatches to the
   YTM player (`#movie_player` object) or clicks DOM buttons by aria-label
   for shuffle/repeat/like.
4. Honours `window.__VIBEYTM_TARGET_VID__` — when Rust navigates to a new
   track, the bridge ignores stale reports until the YTM player catches up.
   This prevents the UI from briefly showing the previous track after a
   play_track call.

Rust reads `__VIBEYTM_STATE__` by calling
`WKWebView.evaluateJavaScript_completionHandler`. The result flows back via
a `block2::RcBlock` into a static `Mutex<Option<String>>`, and a Tokio task
polls it every 150 ms.

**Concurrency-critical**: for `ytm_api_call` (cross-origin fetch executed in
the YTM context), results are stored in `static API_RESULTS: OnceLock<Mutex<
HashMap<u64, String>>>` keyed by `req_id`, not a single slot — two
concurrent API calls would stomp each other otherwise. Timeout is 30 s.

### 3.2 YTM internal API

YTM's internal API lives at `https://music.youtube.com/youtubei/v1/{endpoint}`.
We can't call it from our own fetch (cross-origin + no cookies), so we
execute `fetch(...)` inside the YTM window via JS eval. The JS:

1. Reads `SAPISID` from `document.cookie`.
2. Computes `SHA-1(timestamp + ' ' + sapisid + ' ' + origin)` → creates the
   `Authorization: SAPISIDHASH {ts}_{hex}` header.
3. Adds `X-Origin: https://music.youtube.com` and `X-Goog-AuthUser: 0`.
4. Posts the body with a `context: { client: { clientName: 'WEB_REMIX',
   clientVersion: '1.20250407.01.00', hl, gl: 'US' } }` wrapper merged in.
5. Writes the response text to `window.__VIBEYTM_API_{req_id}__` (a
   per-request slot — global so Rust can read it).

Endpoints used:
- `browse` — home, explore, playlist detail, library tabs
- `search` — filtered or unfiltered search
- `music/get_search_suggestions` — autocomplete

---

## 4. Rust Backend Structure

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── build.rs
└── src/
    ├── main.rs
    ├── lib.rs                     ← tauri::Builder + setup, window
    ├── logging.rs                 ← init_logging (tracing_subscriber)
    ├── cache/
    │   └── mod.rs                 ← Cache struct (disk LRU + TTL + jitter)
    ├── commands/
    │   ├── mod.rs                 ← re-exports
    │   ├── browse.rs              ← search, get_home, get_explore,
    │   │                             get_playlist, get_library_*,
    │   │                             search_suggestions
    │   ├── cache.rs               ← cache_fetch_image, cache_clear,
    │   │                             cache_stats, cache_get_track,
    │   │                             cache_put_track
    │   └── player.rs              ← on_track_changed, on_*, play, pause,
    │                                 toggle_play, next_track, previous_track,
    │                                 play_track, seek, set_volume,
    │                                 toggle_like, toggle_shuffle,
    │                                 cycle_repeat, set_repeat,
    │                                 hide_ytm, show_ytm, inject_ytm_bridge
    ├── events/
    │   ├── mod.rs
    │   ├── bus.rs                 ← EventBus: tokio::sync::broadcast
    │   └── types.rs               ← AppEvent, PlaybackCommand
    ├── integrations/
    │   ├── mod.rs                 ← Integration trait (Send + Sync)
    │   └── global_shortcuts.rs    ← ⌘⌥Space play/pause, etc.
    ├── state/
    │   ├── mod.rs
    │   ├── player.rs              ← TrackInfo, PlayerState, PlaybackStatus,
    │   │                             RepeatMode, SharedPlayerState type
    │   └── settings.rs            ← AppSettings (dormant)
    ├── tray/
    │   └── mod.rs                 ← macOS tray icon + menu
    ├── webview_bridge/
    │   ├── mod.rs                 ← get_ytm_window, hide/show,
    │   │                             inject_bridge, navigate_to_track,
    │   │                             navigate_to_track_with_playlist,
    │   │                             exec_playback_command{,_with_args}
    │   ├── api.rs                 ← ytm_api_call (fetch-in-YTM via eval)
    │   └── poller.rs              ← start_poller (bridge state → events)
    └── ytm_api/
        ├── mod.rs                 ← YtmApi (search, get_home, …) + parsers
        └── types.rs               ← SearchResults, AlbumSummary,
                                      ArtistSummary, PlaylistSummary,
                                      PlaylistDetail, Shelf, ShelfContent,
                                      TopResult (camelCase serde)
```

### 4.1 `state/player.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackStatus { Playing, Paused, Buffering, #[default] Idle }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RepeatMode { #[default] None, One, All }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub status: PlaybackStatus,
    pub track: Option<TrackInfo>,
    pub position_secs: f64,
    pub volume: f64,
    pub is_liked: bool,
    pub repeat_mode: RepeatMode,
    pub is_shuffled: bool,
    pub queue: Vec<TrackInfo>,
}

pub type SharedPlayerState = Arc<RwLock<PlayerState>>;
```

### 4.2 `ytm_api/types.rs` (camelCase serde for JS interop)

```rust
pub struct SearchResults {
    pub songs: Vec<TrackInfo>,
    pub albums: Vec<AlbumSummary>,
    pub artists: Vec<ArtistSummary>,
    pub playlists: Vec<PlaylistSummary>,
    #[serde(default)]
    pub top_album: Option<AlbumSummary>,
}

pub struct AlbumSummary {
    pub browse_id: String,
    pub title: String,
    pub artist: String,
    pub artwork_url: String,
    pub year: Option<String>,
}

pub struct ArtistSummary {
    pub channel_id: String,
    pub name: String,
    pub avatar_url: String,
    pub subscriber_count: Option<String>,
}

pub struct PlaylistSummary {
    pub playlist_id: String,
    pub title: String,
    pub artwork_url: String,
    pub track_count: Option<u32>,
}

pub struct PlaylistDetail {
    pub playlist_id: String,
    pub title: String,
    pub description: Option<String>,
    pub artwork_url: String,
    pub track_count: Option<u32>,
    pub tracks: Vec<TrackInfo>,
}

pub struct Shelf { pub title: String, pub items: ShelfContent }

#[serde(tag = "kind", content = "data")]
pub enum ShelfContent {
    Albums(Vec<AlbumSummary>),
    Playlists(Vec<PlaylistSummary>),
    Songs(Vec<TrackInfo>),
    Artists(Vec<ArtistSummary>),
}
```

### 4.3 YTM API parsers — critical details

- **browseId prefixes matter**:
  - `MPRE…` = real album, used as-is
  - `VL…` / `RDCLAK…` / `PL…` / `OLAK…` = playlist, prepend `VL` unless already
    present
  - `UC…` = artist channel
- **Home page** uses `musicCarouselShelfRenderer` in
  `singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer`.
  Follow continuation tokens (`nextContinuationData.continuation`) up to 5
  times to get all shelves.
- **Search response** lives at
  `contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer`.
- **Top-result card** is `musicCardShelfRenderer`. Its navigation is at
  `onTap.browseEndpoint.browseId` — *not* `navigationEndpoint.browseEndpoint.browseId`
  (common mistake). Preview tracks (up to 3) live at `card.contents[].musicResponsiveListItemRenderer`.
- **Playlist detail** header can be under any of:
  - `contents.twoColumnBrowseResultsRenderer.tabs[0].…sectionListRenderer.contents[0].musicResponsiveHeaderRenderer`
  - …wrapped in `musicEditablePlaylistDetailHeaderRenderer.header.musicResponsiveHeaderRenderer` (user-created playlists)
  - `header.musicImmersiveHeaderRenderer`
  - `header.musicDetailHeaderRenderer`
  - `header.musicEditablePlaylistDetailHeaderRenderer.header.musicDetailHeaderRenderer`
- **Tracks in a playlist** live under either
  `musicPlaylistShelfRenderer.contents[].musicResponsiveListItemRenderer` OR
  `musicShelfRenderer.contents[].musicResponsiveListItemRenderer` (albums vs
  playlists). Walk all sections of `twoColumnBrowseResultsRenderer.secondaryContents`
  or `singleColumnBrowseResultsRenderer.tabs[0]....sectionListRenderer`.
- **Track duration** is at:
  - `fixedColumns[0].musicResponsiveListItemFixedColumnRenderer.text.runs` (playlists/albums — check first)
  - `flexColumns[2].musicResponsiveListItemFlexColumnRenderer.text.runs` (search results)
  - Filter empty strings between sources.
- **Artwork fallback** when the renderer has no thumbnail:
  `https://i.ytimg.com/vi/{videoId}/hqdefault.jpg`. Apply in both
  `parse_track_from_list_item` and `parse_track_from_two_row`.
- **Single-video `musicTwoRowItemRenderer`** items have
  `navigationEndpoint.watchEndpoint.videoId` (no browseId) — they're songs,
  not albums. A `dispatch_two_row_item` helper must check for this FIRST,
  then fall back to album/playlist/artist parsing.

### 4.4 `parse_search_results(data, filter)` — the important parts

- When `filter.is_none()`, skip `musicCardShelfRenderer` sections entirely
  (we don't use the raw card; latest-album goes through a separate call).
- For `musicShelfRenderer` sections:
  - `FILTER_ALBUMS` → parse as `AlbumSummary`
  - `FILTER_ARTISTS` → parse as `ArtistSummary`
  - else (songs / videos / unfiltered) → parse as `TrackInfo`
- **Top album on unfiltered search**: while walking unfiltered results,
  collect every `MPRE`-prefixed item and keep the one with the highest year
  from `secondary_text.split(' • ').last()`. But this list is curated and
  rarely has the latest release, so we **also** fire a parallel
  album-filtered search in `commands/browse.rs::search` and overwrite
  `top_album` with `max_by_key(year)` from that fuller list. Only on
  unfiltered searches (when filter is None).

### 4.5 `commands/browse.rs::search` pattern

```rust
#[tauri::command]
pub async fn search(query, filter, app, api, cache) -> Result<SearchResults, String> {
    let is_unfiltered = filter.is_none();
    let mut result = api.search(&app, &query, filter).await?;
    enrich_tracks(&cache, &mut result.songs);

    if is_unfiltered {
        // Parallel album-filtered search → pick latest year
        let albums_filter = "EgWKAQIYAWoSEA4QCRAKEAUQBBADEBUQEBAR".to_string();
        if let Ok(albums_result) = api.search(&app, &query, Some(albums_filter)).await {
            let latest = albums_result.albums.into_iter()
                .filter(|a| a.browse_id.starts_with("MPRE"))
                .max_by_key(|a| a.year.as_deref().and_then(|y| y.parse::<u32>().ok()).unwrap_or(0));
            if let Some(latest) = latest { result.top_album = Some(latest); }
        }
    }
    Ok(result)
}
```

The `enrich_tracks` helper backfills zero-duration tracks from a side cache
and saves any durations it sees. It runs on every browse command. `enrich_shelves`
iterates shelves and enriches `Songs` content.

### 4.6 Category filter params (URL-base64 of a protobuf — these are stable)

```ts
Songs:     'EgWKAQIIAWoSEA4QCRAKEAUQBBADEBUQEBAR'
Albums:    'EgWKAQIYAWoSEA4QCRAKEAUQBBADEBUQEBAR'
Artists:   'EgWKAQIgAWoSEA4QCRAKEAUQBBADEBUQEBAR'
Videos:    'EgWKAQIQAWoSEA4QCRAKEAUQBBADEBUQEBAR'
```

### 4.7 Disk cache (`cache/mod.rs`)

```rust
pub const MAX_IMAGE_CACHE_BYTES: u64 = 1024 * 1024 * 1024;       // 1 GB
pub const BASE_TTL_SECS: u64 = 7 * 24 * 60 * 60;                 // 7 days
pub const MAX_JITTER_SECS: u64 = 24 * 60 * 60;                   // up to +24h

fn ttl_for(key_hash: &[u8]) -> u64 {
    let jitter = (u64::from(key_hash[0]) << 8 | u64::from(key_hash[1]))
        % MAX_JITTER_SECS;
    BASE_TTL_SECS + jitter
}
```

- Layout:
  - `{app_data}/cache/images/{sha256(url)}.bin`
  - `{app_data}/cache/tracks/{videoId}.json`
- Per-entry TTL = 7 days + jitter derived from the key's own sha256, so
  cache entries written in the same minute don't all expire together.
- `get_or_fetch_image(url)`:
  1. If file exists and not expired, touch mtime (LRU refresh) and return
     path.
  2. Otherwise, `reqwest::get(url)` → write to disk, run
     `evict_if_needed_locked` (if total > 1 GB, remove oldest files by
     mtime down to 90% of cap).
- `put_track_duration(video_id, secs)` — side cache for backfill (see 4.5).
- `get_track_duration(video_id)` → `Option<f64>`.
- `clear()` returns bytes freed.
- `stats()` returns `{image_count, image_bytes, track_count, track_bytes, total_bytes, max_bytes}`.

Enable `tauri` feature flag `protocol-asset`, and in `tauri.conf.json`:

```json
"assetProtocol": { "enable": true, "scope": ["$APPDATA/**", "$APPLOCALDATA/**"] }
```

so the frontend can `convertFileSrc(path)` to get an `asset://` URL for
cached images.

### 4.8 `webview_bridge/mod.rs::navigate_to_track[_with_playlist]`

Navigating the YTM window must use SPA navigation (not full reload —
`window.location.href = ...` is slow). We click an anchor programmatically:

```rust
let js = format!(r#"(function() {{
    var vid = '{vid}';
    window.__VIBEYTM_TARGET_VID__ = vid;
    var a = document.createElement('a');
    a.href = '/watch?v=' + vid;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {{ try {{ document.body.removeChild(a); }} catch(e) {{}} }}, 100);
}})();"#);
```

Setting `__VIBEYTM_TARGET_VID__` makes the bridge ignore stale state reports
until the YTM player matches the target videoId.

### 4.9 `lib.rs::run` — app setup

- `tauri::Builder::default()`
- Plugins: `tauri_plugin_opener`, `tauri_plugin_notification`,
  `tauri_plugin_global_shortcut`, `tauri_plugin_deep_link` (schemes:
  `vibeytm`).
- `manage(EventBus)`, `manage(SharedPlayerState)`, `manage(YtmApi::new())`,
  `manage(Cache::new({app_data}/cache))`.
- `invoke_handler!(…)` — list every command; search_suggestions,
  cache_*, player controls, browse_*.
- Setup closure:
  - `tray::setup_tray(app.handle(), bus)`
  - Spawn each integration via `tauri::async_runtime::spawn`
  - Build the hidden YTM window with Safari user agent:
    `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15"`
  - Inject `ytm-compat.js` + `ytm-player-bridge.js` as initialization
    scripts.
  - Start `webview_bridge::poller::start_poller`.
  - Subscribe to PlaybackCommand events on the bus and forward to the
    YTM window via `exec_playback_command`.

---

## 5. JS Bridge (`scripts/inject/ytm-player-bridge.js`)

```js
(function () {
  'use strict';
  window.__VIBEYTM_STATE__ = null;
  window.__VIBEYTM_DEBUG__ = [];
  function log(msg) { /* ring buffer of last 50 messages */ }
  function getPlayer() { return document.querySelector('#movie_player'); }

  function update() {
    const player = getPlayer();
    if (!player) return;

    // Target guard — ignore stale state while navigating to a requested track
    const target = window.__VIBEYTM_TARGET_VID__;
    const videoId = /* from player.getVideoData().video_id, fallback URL */;
    if (target) {
      if (videoId === target) window.__VIBEYTM_TARGET_VID__ = null;
      else return;
    }

    // Read status/title/artist/artwork/position/duration/volume
    // Read shuffle: bar.hasAttribute('shuffle-on') || .shuffle aria-pressed
    // Read repeat: bar.getAttribute('repeat-mode') or aria-label of Repeat btn
    //   (values: "NONE"/"ALL"/"ONE" → "none"/"all"/"one")
    // Read like: ytmusic-like-button-renderer[like-status] === 'LIKE'

    // Artwork: prefer .image.ytmusic-player-bar img, replace w\d+-h\d+ with
    // w512-h512. Fallback to img.youtube.com/vi/{videoId}/hqdefault.jpg

    window.__VIBEYTM_STATE__ = {
      status, title, artist, album: '', artworkUrl, videoId,
      positionSecs, durationSecs, volume,
      isShuffled, repeatMode, isLiked,
    };
  }

  window.__VIBEYTM_COMMAND__ = function (cmd, args) {
    const player = getPlayer();
    if (!player) return;
    function setStatusOptimistic(s) {
      if (window.__VIBEYTM_STATE__) window.__VIBEYTM_STATE__.status = s;
    }
    switch (cmd) {
      case 'play': player.playVideo(); setStatusOptimistic('playing'); break;
      case 'pause': player.pauseVideo(); setStatusOptimistic('paused'); break;
      case 'toggle_play':
        if (player.getPlayerState() === 1) { player.pauseVideo(); setStatusOptimistic('paused'); }
        else { player.playVideo(); setStatusOptimistic('playing'); }
        break;
      case 'next': player.nextVideo(); break;
      case 'previous': player.previousVideo(); break;
      case 'seek': player.seekTo(args.secs, true); break;
      case 'set_volume': player.setVolume(Math.round(args.level * 100)); break;

      // These click real YTM buttons — target by aria-label, scoped to
      // ytmusic-player-bar, and refuse to click anything with 'next' or
      // 'previous' in its label (defensive). Optimistically update state.
      case 'toggle_shuffle': { ... }
      case 'cycle_repeat':   { ... }
      case 'toggle_like':    { ... }
    }
  };

  // Wait for #movie_player, then setInterval(update, 150)
  // Must run on music.youtube.com only — guard with window.location.hostname.
})();
```

**Why 150 ms**: paired with the 150 ms Rust poller, perceived latency for
play/pause is two poll cycles ≈ 300 ms — but paired with optimistic
frontend state updates (§ 7.5), the user sees instant feedback and the real
state reconciles in the background.

---

## 6. Frontend Structure

```
src/
├── main.tsx                     ← React 19 entry, <StrictMode>
├── App.tsx                      ← root: routing state + overlays
├── styles/
│   ├── tokens.css               ← CSS custom properties
│   └── global.css               ← resets + user-select rules + ::selection
├── lib/
│   ├── types.ts                 ← PlayerState, TrackInfo, SearchResults,
│   │                             Shelf, PlaylistDetail, etc.
│   ├── events.ts                ← EVENTS = { TRACK_CHANGED: ... } constants
│   └── ipc.ts                   ← playerApi, ytmApi, browseApi, cacheApi
├── hooks/
│   ├── useTauriEvent.ts         ← subscribe to Tauri events
│   └── usePlayerState.ts        ← derives PlayerState from events
├── components/
│   ├── CachedImage.tsx          ← disk-cache aware image component
│   ├── MarqueeText.tsx          ← hover-activated marquee for long text
│   ├── browse/
│   │   ├── AlbumCard.tsx
│   │   ├── SongRow.tsx
│   │   └── ShelfRow.tsx
│   ├── layout/
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx
│   │   └── PlayerBar.tsx
│   ├── player/
│   │   └── NowPlaying.tsx
│   └── pages/
│       ├── HomePage.tsx
│       ├── ExplorePage.tsx
│       ├── SearchPage.tsx
│       ├── LibraryPage.tsx
│       ├── PlaylistDetailPage.tsx
│       ├── SettingsPage.tsx
│       └── LoginPage.tsx
└── vite-env.d.ts
```

---

## 7. Frontend Details

### 7.1 Design tokens (`styles/tokens.css`)

CSS custom properties:

```css
:root {
  /* Colors — oklch only, dark theme */
  --color-bg: oklch(12% 0 0);
  --color-surface-1: oklch(16% 0 0);
  --color-surface-2: oklch(20% 0 0);
  --color-surface-3: oklch(24% 0 0);
  --color-text-primary: oklch(98% 0 0);
  --color-text-secondary: oklch(70% 0 0);
  --color-text-tertiary: oklch(55% 0 0);
  --color-accent: oklch(62% 0.24 25);    /* YTM red-ish */
  --color-border: oklch(100% 0 0 / 0.08);

  /* Spacing — 4px base scale */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;
  --space-4: 16px;  --space-5: 24px;  --space-6: 32px;
  --space-8: 48px;  --space-10: 64px;

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  --text-xs: 11px; --text-sm: 13px; --text-base: 15px;
  --text-lg: 18px; --text-xl: 22px; --text-2xl: 28px;

  /* Radii */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-full: 999px;

  /* Motion */
  --duration-fast: 120ms;
  --duration-normal: 200ms;
  --duration-slow: 320ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  /* Layout */
  --sidebar-width: 220px;
  --player-bar-height: 84px;
  --title-bar-height: 28px;  /* macOS traffic-light height */
}
```

### 7.2 `global.css` — selection rules

```css
html, body, #root { height: 100%; overflow: hidden; }

body {
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text-primary);
  /* Desktop app feel: nothing is selectable by default. */
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}

/* Re-enable selection inside form fields only */
input, textarea, [contenteditable='true'] {
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

::selection {
  background: oklch(62% 0.24 25 / 0.4);
  color: var(--color-text-primary);
}
```

### 7.3 `App.tsx` — root component

State:
- `isLoggedIn: boolean` — set via `LoginPage` confirm button
- `currentPath: string` — `'home' | 'search' | 'explore' | 'settings' | 'library' | 'library/playlists' | 'library/songs' | 'library/albums' | 'library/artists'`
- `isNowPlayingOpen: boolean`
- `viewingPlaylist: { id: string, autoPlay: boolean } | null`
- `lastToggleAtRef: useRef<number>` — 450 ms lockout for the now-playing toggle

```tsx
const toggleNowPlaying = useCallback(() => {
  const now = Date.now();
  if (now - lastToggleAtRef.current < 450) return;
  lastToggleAtRef.current = now;
  setIsNowPlayingOpen((prev) => !prev);
}, []);

const openPlaylistDetail = useCallback((id: string) => {
  setViewingPlaylist({ id, autoPlay: false });
}, []);

const openPlaylistAutoPlay = useCallback((id: string) => {
  setViewingPlaylist({ id, autoPlay: true });
}, []);
```

`renderPage()` returns the current page based on `currentPath`. It does
**not** handle `viewingPlaylist` — instead, the JSX wraps `renderPage()` in
a relative-positioned div and conditionally overlays `PlaylistDetailPage`
on top:

```tsx
<AppShell
  currentPath={currentPath}
  onNavigate={(path) => {
    setViewingPlaylist(null);
    setIsNowPlayingOpen(false);       // auto-hide overlay on tab change
    setCurrentPath(path);
  }}
  nowPlayingOpen={isNowPlayingOpen}
  onToggleNowPlaying={toggleNowPlaying}
>
  <div style={{ position: 'relative', height: '100%' }}>
    {renderPage()}
    {viewingPlaylist && (
      <div style={{ position: 'absolute', inset: 0, background: 'var(--color-bg)', zIndex: 20 }}>
        <PlaylistDetailPage
          playlistId={viewingPlaylist.id}
          autoPlay={viewingPlaylist.autoPlay}
          onBack={() => setViewingPlaylist(null)}
        />
      </div>
    )}
  </div>
</AppShell>
```

**Critical**: the underlying page stays mounted while the playlist detail
overlay is open. This preserves its state (SearchPage query + results
cache, HomePage scroll, etc.) so pressing Back returns to exactly where the
user was.

### 7.4 `AppShell.tsx`

Grid layout: `gridTemplateColumns: 'var(--sidebar-width) 1fr'`,
`gridTemplateRows: '1fr'` — NO row reserved for the player bar (it's
`position: fixed`). `<main>` has `paddingBottom: var(--player-bar-height)`
to keep content above the fixed player bar. `<main>` does NOT adjust
marginRight when now-playing is open (the overlay sits on top).

Also renders a `<div data-tauri-drag-region>` at the top so the user can
drag the window by the title bar area.

### 7.5 `usePlayerState.ts`

```ts
export interface UsePlayerState extends PlayerState {
  applyOptimistic: (patch: Partial<PlayerState>) => void;
}

export function usePlayerState(): UsePlayerState {
  const [state, setState] = useState<PlayerState>(DEFAULT_STATE);

  // Initial fetch
  useEffect(() => { playerApi.getState().then(setState).catch(() => {}); }, []);

  // Subscribe to each Tauri event
  useTauriEvent(EVENTS.TRACK_CHANGED, (track) =>
    setState((prev) => ({ ...prev, track })));
  useTauriEvent(EVENTS.STATUS_CHANGED, (status) =>
    setState((prev) => ({ ...prev, status })));
  useTauriEvent(EVENTS.POSITION_UPDATED, (positionSecs) =>
    setState((prev) => ({ ...prev, positionSecs })));
  useTauriEvent(EVENTS.VOLUME_CHANGED, (volume) =>
    setState((prev) => ({ ...prev, volume })));
  useTauriEvent(EVENTS.SHUFFLE_CHANGED, (isShuffled) =>
    setState((prev) => ({ ...prev, isShuffled })));
  useTauriEvent(EVENTS.REPEAT_CHANGED, (repeatMode) =>
    setState((prev) => ({ ...prev, repeatMode })));
  useTauriEvent(EVENTS.LIKE_CHANGED, (isLiked) =>
    setState((prev) => ({ ...prev, isLiked })));

  const applyOptimistic = useCallback((patch) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  return { ...state, applyOptimistic };
}
```

### 7.6 `ipc.ts`

```ts
export const playerApi = {
  play, pause, togglePlay, next, previous,
  seek, setVolume,
  getState: () => invoke<PlayerState>('get_player_state'),
  playTrack: (videoId, playlistId?) => invoke('play_track', { videoId, playlistId: playlistId ?? null }),
  toggleLike, toggleShuffle, cycleRepeat,
  setRepeat: (mode) => invoke('set_repeat', { mode }),
};

export const ytmApi = { hideYtm, showYtm, injectBridge };

export const browseApi = {
  search: (query, filter?) => invoke<SearchResults>('search', { query, filter: filter ?? null }),
  searchSuggestions: (query) => invoke<string[]>('search_suggestions', { query }),
  getHome, getExplore,
  getPlaylist: (playlistId) => invoke<PlaylistDetail>('get_playlist', { playlistId }),
  getLibraryPlaylists, getLibrarySongs, getLibraryAlbums, getLibraryArtists,
};

export const cacheApi = {
  fetchImage: (url) => invoke<string>('cache_fetch_image', { url }),
  clear: () => invoke<number>('cache_clear'),
  stats: () => invoke<CacheStats>('cache_stats'),
  convertToAssetUrl: (path) => convertFileSrc(path),  // from @tauri-apps/api/core
};

export async function playFirstFromPlaylist(playlistId: string): Promise<void> {
  const detail = await browseApi.getPlaylist(playlistId);
  if (detail.tracks.length > 0 && detail.tracks[0].videoId) {
    await playerApi.playTrack(detail.tracks[0].videoId, playlistId);
  }
}
```

### 7.7 `CachedImage.tsx`

```tsx
// In-memory resolved map (remote URL → asset:// URL) survives re-renders
const inflight = new Map<string, Promise<string | null>>();
const resolved = new Map<string, string>();

async function resolveCached(url) {
  if (resolved.has(url)) return resolved.get(url);
  // dedupe concurrent requests by URL
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    try {
      const path = await cacheApi.fetchImage(url);
      const asset = cacheApi.convertToAssetUrl(path);
      resolved.set(url, asset);
      return asset;
    } catch { return null; }
    finally { inflight.delete(url); }
  })();
  inflight.set(url, p);
  return p;
}

export const CachedImage: FC<{ src, alt, width?, height?, style?, onError?, loading? }> = ({ src, ... }) => {
  const [displayUrl, setDisplayUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!src) { setDisplayUrl(undefined); return; }
    let cancelled = false;
    const tryReveal = async (url) => {
      // Pre-decode off-DOM so the image NEVER appears half-painted
      try {
        const probe = new Image();
        probe.src = url;
        await probe.decode();
      } catch {}
      if (cancelled) return;
      setDisplayUrl(url);
    };
    const cached = resolved.get(src);
    if (cached) void tryReveal(cached);
    else resolveCached(src).then((asset) => { if (!cancelled) void tryReveal(asset ?? src); });
    return () => { cancelled = true; };
  }, [src]);

  if (!displayUrl) return null;     // render nothing until fully decoded
  return <img src={displayUrl} alt={alt} width={width} height={height} loading={loading ?? 'lazy'} style={style} onError={onError} />;
};
```

### 7.8 `MarqueeText.tsx`

```tsx
const DEFAULT_SPEED = 40;  // px/s — slower than native marquee, more readable

export const MarqueeText: FC<{ text, style?, speedPxPerSec?, hovered? }> = ({ text, style, speedPxPerSec = DEFAULT_SPEED, hovered: hoveredProp }) => {
  const [internalHover, setInternalHover] = useState(false);
  const [offset, setOffset] = useState(0);
  const [duration, setDuration] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  const hovered = hoveredProp ?? internalHover;

  const startMarquee = () => {
    const el = ref.current; if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth;   // natural overflow px
    if (overflow > 0) {
      setOffset(-overflow);                              // stop exactly when all text shown
      setDuration(overflow / speedPxPerSec);             // constant speed
    }
  };
  const stopMarquee = () => setOffset(0);

  // onMouseEnter / onMouseLeave self-detect when hoveredProp is undefined
  // When hoveredProp is provided, sync via conditional calls

  return (
    <div
      onMouseEnter={hoveredProp === undefined ? () => { setInternalHover(true); startMarquee(); } : undefined}
      onMouseLeave={hoveredProp === undefined ? () => { setInternalHover(false); stopMarquee(); } : undefined}
      style={{
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: offset < 0 ? 'clip' : 'ellipsis',
        ...style,
      }}
    >
      <span
        ref={ref}
        style={{
          display: 'inline-block',                        // CRITICAL: sizes to content width so translate actually moves text
          maxWidth: offset < 0 ? 'none' : '100%',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: offset < 0 ? 'clip' : 'ellipsis',
          verticalAlign: 'top',
          transform: `translateX(${offset}px)`,
          transition: offset < 0
            ? `transform ${duration}s linear`
            : 'transform var(--duration-normal) var(--ease-out)',
        }}
      >
        {text}
      </span>
    </div>
  );
};
```

**Key insight**: the inner must be `display: inline-block` so its width
equals its content; only then does `translateX` visibly move text
characters across the viewport instead of just shifting an empty block.

### 7.9 `browse/AlbumCard.tsx`

Props: `{ artworkUrl, title, subtitle, onClick?, onPlay?, hideCaption? }`.

Structure:

```tsx
<button onClick={onClick} onMouseEnter/Leave ...>
  <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: var(--radius-lg), overflow: 'hidden' }}>
    <CachedImage src={artworkUrl} ... />
    {/* darkening overlay — pointer-events: none; decorative */}
    <div style={{ position: 'absolute', inset: 0, background: 'oklch(0% 0 0 / 0.35)', opacity: isHovered ? 1 : 0, pointerEvents: 'none' }} />
    {/* Play button — 44×44, ONLY this catches onPlay clicks, stopPropagation */}
    {onPlay && <button onClick={(e) => { e.stopPropagation(); onPlay(); }} style={{ position: 'absolute', top/left 50%, transform centered, opacity: isHovered ? 1 : 0, background: var(--color-accent) }}>▶</button>}
  </div>
  {!hideCaption && <div>{title} / {subtitle}</div>}
</button>
```

**Click rules** (MANDATORY everywhere AlbumCard is used):
- Clicking the **card** anywhere except the play button → `onClick` (open
  detail).
- Clicking the **play button** → `onPlay` **and** opens detail (both).
- The overlay must have `pointer-events: none` — otherwise it eats all
  clicks and only the first card appears clickable.
- The play button's onClick MUST call `e.stopPropagation()` — otherwise
  the card's onClick also fires.
- `hideCaption` used only by the unified search "Top result" which renders
  its own title column.

### 7.10 `browse/SongRow.tsx`

```tsx
const formatDuration = (secs) => `${Math.floor(secs/60)}:${String(Math.floor(secs%60)).padStart(2,'0')}`;

export const SongRow: FC<{ track, index?, onClick?, playlistId? }> = ({ track, index, onClick, playlistId }) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (onClick) onClick();
    else if (track.videoId) playerApi.playTrack(track.videoId, playlistId).catch(() => {});
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: var(--space-3), width: '100%', padding: '..', background: isHovered ? var(--color-surface-2) : 'transparent', borderRadius: var(--radius-md), textAlign: 'left' }}
    >
      {index !== undefined && <span style={{ width: '24px', ... }}>{index}</span>}

      {/* 40x40 artwork */}
      <div style={{ width: 40, height: 40, ... }}>
        <CachedImage src={track.artworkUrl} alt={...} width={40} height={40} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <MarqueeText text={track.title} hovered={isHovered} style={{ fontSize: var(--text-sm), fontWeight: 500, color: var(--color-text-primary) }} />
        <div style={{ fontSize: var(--text-xs), color: var(--color-text-secondary), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {track.artist}
        </div>
      </div>

      {track.durationSecs > 0 && <span style={{ fontSize: var(--text-xs), color: var(--color-text-tertiary) }}>{formatDuration(track.durationSecs)}</span>}
    </button>
  );
};
```

### 7.11 `browse/ShelfRow.tsx`

```tsx
export const ShelfRow: FC<{ title: string, children }> = ({ title, children }) => (
  <section style={{ marginBottom: 'var(--space-8)' }}>
    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>{title}</h2>
    {children}
  </section>
);
```

### 7.12 `layout/Sidebar.tsx`

```
┌─────────────┐
│  VibeYTM    │
│             │
│  Home       │
│  Search     │
│  Explore    │
│             │
│  Library    │
│    Playlists
│    Songs    │
│    Albums   │
│    Artists  │
│             │
│  Settings   │
└─────────────┘
```

- Plain `<button>` per item, calls `onNavigate(path)`.
- Active tab: accent color + subtle background tint.
- Library is a group with sub-tabs. When currentPath starts with `library/`,
  that sub-tab is highlighted; clicking `Library` itself goes to `library/playlists`.
- Width = `var(--sidebar-width)` = 220px. Background = `var(--color-surface-1)`.

### 7.13 `layout/PlayerBar.tsx`

Position: `fixed; bottom: 0; left: 0; right: 0; height: var(--player-bar-height);
z-index: 100; grid-template-columns: 1fr 2fr 1fr`.

Three sections:

**Left** — now-playing thumbnail + title/artist.
- Status dot (green when playing, tertiary when idle).
- **Cover button** (48×48, clickable) → `onToggleNowPlaying`. Shows a
  2 px accent border when `nowPlayingOpen` is true. Uses `CachedImage` with
  `pickArtwork(track)` fallback to `i.ytimg.com/vi/{vid}/hqdefault.jpg`.
  `onError` swaps to the YT thumbnail service as a last resort.
- `<MarqueeText text={track.title} />` (self-detects hover).
- Artist as a plain div (ellipsis).

**Center** — transport + progress.
- Shuffle (`⇋`), Previous (`◄◄`), Play/Pause (40×40 circle, accent
  background), Next (`►►`), Repeat (using `<RepeatIcon mode={repeatMode}/>`
  below).
- `RepeatIcon` — a `<span>` containing `↻`; when `mode === 'one'` an
  absolutely-positioned "1" badge (9 px, accent bg, oklch(100% 0 0)
  text, border-radius full) sits bottom-right.
- Progress bar: `<input type="range">` styled with a linear-gradient
  background showing progress. min=0, max=duration, value=positionSecs,
  onChange calls `playerApi.seek(Number(e.target.value))`.
- Time labels `{formatTime(positionSecs)}` and `{formatTime(duration)}` on
  either side.

**Right** — like, volume, now-playing toggle.
- Like (♥ / ♡ — accent when liked).
- Volume `<input type="range">` bound to `playerApi.setVolume(level)`.
- `𝄢` (Now Playing toggle) — also calls `onToggleNowPlaying` (same
  handler as the cover click).

**Optimistic handlers** — each transport button flips local state before
invoking, rolls back on error:

```tsx
const handleTogglePlay = () => {
  applyOptimistic({ status: isPlaying ? 'paused' : 'playing' });
  playerApi.togglePlay().catch(() => applyOptimistic({ status: isPlaying ? 'playing' : 'paused' }));
};
const handleToggleShuffle = () => {
  applyOptimistic({ isShuffled: !isShuffled });
  playerApi.toggleShuffle().catch(() => applyOptimistic({ isShuffled }));
};
const handleCycleRepeat = () => {
  applyOptimistic({ repeatMode: NEXT_REPEAT_MODE[repeatMode] });
  playerApi.cycleRepeat().catch(() => applyOptimistic({ repeatMode }));
};
const handleToggleLike = () => {
  applyOptimistic({ isLiked: !isLiked });
  playerApi.toggleLike().catch(() => applyOptimistic({ isLiked }));
};
```

`NEXT_REPEAT_MODE = { none: 'all', all: 'one', one: 'none' }`.

**TransportButton** helper accepts `label: ReactNode`, optional `ariaLabel`,
`onClick`, `size?: string`, `isActive?: boolean`. 36×36 rounded-full, accent
color when active, hover scale to 1.08, opacity 0.8.

### 7.14 `player/NowPlaying.tsx`

Full-page overlay that covers the main content area (between sidebar and
player bar):

```tsx
<div
  style={{
    position: 'fixed',
    top: 'var(--title-bar-height)',
    left: 'var(--sidebar-width)',
    right: 0,
    bottom: 'var(--player-bar-height)',
    background: 'var(--color-bg)',
    zIndex: 80,
    opacity: isOpen ? 1 : 0,
    transform: isOpen ? 'translateY(0)' : 'translateY(24px)',
    pointerEvents: isOpen ? 'auto' : 'none',
    willChange: 'opacity, transform',
    transition: 'opacity 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-6)',
    overflow: 'hidden',
  }}
  aria-hidden={!isOpen}
>
  <button type="button" onClick={onClose} aria-label="Close now playing"
    style={{ position: 'absolute', top: var(--space-4), right: var(--space-5), ... }}>✕</button>

  {track && (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-5)', width: '100%', height: '100%' }}>
      {/* Cover — largest square that fits the window */}
      <div style={{
        width: 'min(calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-6) * 2 - 160px), calc(100vw - var(--sidebar-width) - var(--space-6) * 2))',
        aspectRatio: '1',
        borderRadius: var(--radius-lg),
        overflow: 'hidden',
        background: var(--color-surface-2),
        boxShadow: '0 24px 60px oklch(0% 0 0 / 0.5)',
        flexShrink: 0,
      }}>
        <CachedImage src={track.artworkUrl || ytmFallback(track.videoId)} ... />
      </div>

      {/* Title + artist + album (centered, below cover) */}
      <div style={{ width: 'min(calc(100vw - var(--sidebar-width) - var(--space-6) * 2), 720px)', textAlign: 'center' }}>
        <MarqueeText text={track.title} style={{ fontSize: var(--text-2xl), fontWeight: 700 }} />
        <div>{track.artist}</div>
        {track.album && <div>{track.album}</div>}
      </div>
    </div>
  )}
</div>
```

- **NO progress bar** — deliberately removed; the player bar already has one.
- **Rapid-click lockout**: the `toggleNowPlaying` handler in `App.tsx`
  uses a `useRef<number>` to reject any second toggle within 450 ms, so
  rapid double-clicks never make the overlay flash open-and-close.
- Auto-hides on tab navigation (handled in `App.tsx`'s `onNavigate`).

### 7.15 Pages

#### HomePage
- Module-level cache: `cachedShelves: Shelf[] | null`, `cachedAt: number`,
  `firstLoadDone: boolean`.
- `CACHE_TTL_MS = 30 * 60 * 1000`. First load of a session always forces a
  refresh (`firstLoadDone = false` initially).
- **Sticky header**: greeting ("Good morning/afternoon/evening" based on
  `new Date().getHours()`) + Refresh button + mood tabs. Wrapped in a
  `position: sticky; top: 0; z-index: 10; background: var(--color-surface-1)`
  div with backdrop blur.
- Mood tabs: `All, Energize, Party, Feel good, Relax, Workout, Commute,
  Romance, Sad, Focus, Sleep`. Clicking a non-All tab fires a
  `browseApi.search(tab, FILTER_SONGS)` and displays a "Mood Songs" shelf.
- Shelves from `browseApi.getHome()`:
  - Songs: **3-column grid** (`gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'`)
    of SongRow (no index).
  - Albums: grid of `AlbumCard`.
  - Artists: horizontal scroll of round avatars.
  - Playlists: grid of `AlbumCard`.
- Click rules (again): card click → `onOpenPlaylist(browseId)`, play button
  → `playFirstFromPlaylist(browseId)` + `onOpenPlaylist(browseId)`.
- React keys: use `${album.browseId || 'album'}-${i}` to avoid collisions when
  browseId is empty.

#### ExplorePage
- Same layout pattern as Home (sticky "Explore" title, 3-col song grid).
- Data from `browseApi.getExplore()`.

#### SearchPage (the big one)
- State:
  - `query: string` — live input
  - `submittedQuery: string` — what the last actual search was for
  - `results: SearchResults | null`
  - `isLoading: boolean`
  - `activeCategory: CategoryTab | null` — **null = unified view**, no tab
    pre-selected
  - `topAlbumPreview: PlaylistDetail | null` — lazy-fetched tracks for the
    top album
  - `topCoverReady: boolean` — cover finished decoding
  - `suggestions: string[]`, `showSuggestions: boolean`,
    `highlightedIndex: number`
  - Caches (`useRef`): `resultsCacheRef: Map<"query|category", SearchResults>`,
    `albumPreviewCacheRef: Map<browseId, PlaylistDetail>`

- **Search input**:
  - Only fires a real search on Enter (or when the user clicks a
    suggestion). Typing alone does not hit the API.
  - After typing ≥ 3 chars, 200 ms debounce → `browseApi.searchSuggestions`
    (top 5 kept).
  - ↓/↑ cycles `highlightedIndex` (wrapping). Enter submits highlighted
    suggestion (or raw query if none). Esc closes the dropdown.
  - Mouse hover updates the highlight; `onMouseDown` submits (fires before
    blur so the menu doesn't disappear first).

- **Tab toggle**: clicking the active tab sets `activeCategory = null`
  (returns to unified view). Clicking an inactive tab sets it.

- **Unified default view** (`activeCategory === null`):
  - Rendered only when: `topAlbum && topAlbumPreview && previewTracks.length > 0
    && topCoverReady`. Until all four are true the block is invisible — no
    loading spinner, no half-rendered cover.
  - Layout:

    ```
    ┌─────────────┐  ALBUM • 2026
    │             │  太陽之子
    │   cover     │  周杰倫
    │             │
    │             │  ▶ Track 1
    └─────────────┘  ▶ Track 2
                     ▶ Track 3
    ```
    Flex row with `align-items: stretch`. Cover is a `<button>` with
    `align-self: stretch; aspect-ratio: 1; flex: 0 0 auto` — the browser
    derives its width from the row height so the bottom of the cover is
    always flush with the bottom of the song list. No JS measurement.
  - Cover has a centered play overlay (52×52) that fades in on hover and
    calls `playFirstFromPlaylist(topAlbum.browseId) + onOpenPlaylist(...)`.
    Clicking anywhere else on the cover just opens the detail page.
  - Right column:
    - `ALBUM • {year}` eyebrow.
    - Title + artist, wrapped in a button that opens the detail.
    - Then **3** `SongRow`s (the first 3 tracks of the album).
  - Below the Top result shelf: matched Songs shelf (vertical SongRow list).

- **Latest album selection** — backend does this; frontend just reads
  `results.topAlbum`.

- **Album preview lazy fetch**: when `results.topAlbum` changes,
  `browseApi.getPlaylist(browseId)` fetches the full album; cache by
  `browseId`; slice `tracks.slice(0, 3)`.

- **Cover decode gate**: on topAlbum change, set `topCoverReady = false`,
  create a `new Image(); img.src = artworkUrl; await img.decode()` off-DOM;
  on success set ready = true. On reject, still set true (don't block
  forever).

- **Tab views**:
  - `Songs`: vertical SongRow list.
  - `Albums`: grid of AlbumCard.
  - `Artists`: horizontal scroll of avatar buttons. Clicking an artist:
    `setActiveCategory(null); submitQuery(artist.name)` — switches to
    unified view with the new query.
  - `Videos`, `Playlists`: "coming soon" placeholders.

#### LibraryPage
- Activated by `currentPath === 'library' | 'library/playlists' | ...`.
- NO top tabs — the sidebar sub-nav IS the tab nav.
- Four sub-views driven by `activeTab` prop: `playlists | songs | albums | artists`.
- Each view fetches once on mount and displays a grid / list.

#### PlaylistDetailPage
- Takes `playlistId`, optional `autoPlay` flag, `onBack`.
- Fetches `browseApi.getPlaylist(playlistId)` + `playerApi.getState()` in
  parallel. If `autoPlay && current track is NOT already in the playlist`,
  plays the first track.
- **Sticky header** (position: sticky; top: 0) with:
  - Back button (← Back) → `onBack()`
  - Grid: `160px 1fr` (cover + info), `align-items: start`
  - Left: 160×160 cover
  - Right: eyebrow ("ALBUM" for MPRE-prefixed, "PLAYLIST" otherwise),
    `<h1>` title (ellipsis), track count, description (clamped to 2 lines
    via `-webkit-line-clamp`), Play all button (accent background).
- Below the sticky header: vertical list of `SongRow` with index 1..N and
  `playlistId` prop so clicking a row plays in the playlist context.
- **Back behaviour**: `App.tsx` mounts this on top of the underlying page
  via an absolute-positioned overlay. Pressing Back = `onBack()` =
  `setViewingPlaylist(null)`, unmounting the overlay and revealing the
  underlying (still-mounted) page with all its state intact.

#### SettingsPage
Sections:

- **General**: Close to tray toggle, Background playback toggle (these are
  cosmetic in current implementation).
- **Integrations**: Desktop notifications toggle.
- **Keyboard Shortcuts** (read-only): Play/Pause = Space, Next = ⌘→,
  Previous = ⌘←.
- **YouTube Music**: buttons for "Sign in to YouTube Music" (calls
  `ytmApi.showYtm`), "Hide YouTube Music window" (`ytmApi.hideYtm`),
  "Re-inject player bridge" (`ytmApi.injectBridge`).
- **Cache**: live stats row showing `{total_bytes formatted} / 1 GB —
  {image_count} images, {track_count} tracks`. "Clear cache" button calls
  `cacheApi.clear()` then `cacheApi.stats()` to refresh. `formatBytes`
  helper (B → KB → MB → GB).
- **About**: Name, version, one-line blurb.

Reusable helpers: `SectionHeading`, `Divider`, `SettingRow`, `ToggleSwitch`,
`OutlinedButton`, `ShortcutBadge`.

#### LoginPage
- Shown until `isLoggedIn === true`.
- Instructions to sign in via the YTM window that opens alongside.
- Buttons: "I'm signed in — let's go" (sets isLoggedIn = true), "Show
  YouTube Music window" (calls `ytmApi.showYtm`), "Skip for now" (also
  sets isLoggedIn = true for dev).

---

## 8. Interaction Flows

### 8.1 Play a track
1. User clicks an `AlbumCard` play button or a `SongRow`.
2. Frontend calls `playerApi.playTrack(videoId, playlistId?)`.
3. Rust `commands/player.rs::play_track`:
   - Sets `PlayerState.track = Loading placeholder` with
     `artworkUrl = https://img.youtube.com/vi/{vid}/hqdefault.jpg`,
     `title = "Loading..."`.
   - Emits `TrackChanged` event.
   - Calls `webview_bridge::navigate_to_track_with_playlist(&window, vid, playlist_id?)`
     which sets `__VIBEYTM_TARGET_VID__` and clicks an anchor link.
4. YTM webview navigates (SPA, <200 ms).
5. Bridge's `update()` waits until the real videoId matches target, then
   starts reporting fresh state.
6. Rust poller reads state, emits `TrackChanged` with the real track (title,
   artist, duration, real artwork).
7. Frontend `usePlayerState` receives the event, re-renders PlayerBar +
   NowPlaying with the real metadata. `enrich_tracks` persists the
   duration to the side cache for future backfills.

### 8.2 Toggle play/pause (perceived latency fix)
1. User clicks the play button.
2. Frontend `handleTogglePlay`:
   - Calls `applyOptimistic({ status: next })` — state flips locally
     immediately, icon changes this frame.
   - Calls `playerApi.togglePlay()`. On error, calls applyOptimistic with
     the old status.
3. Rust forwards `toggle_play` to bridge JS.
4. Bridge's `__VIBEYTM_COMMAND__` calls `player.playVideo() / pauseVideo()`
   AND writes the new status into `__VIBEYTM_STATE__` synchronously (so
   the next poll cycle picks it up regardless of YTM DOM update lag).
5. Poller (150 ms interval) emits the real status; usually it matches the
   optimistic state, no visible change.

### 8.3 Search + latest album + preview
1. User types "jay chou" in the search bar.
2. Every 200 ms of idle → `browseApi.searchSuggestions('jay chou')` →
   dropdown of 5 suggestions.
3. User presses Enter → `submitQuery('jay chou')` → sets
   `submittedQuery`, triggers the search effect.
4. Search effect fires `browseApi.search('jay chou', null)` — unfiltered.
5. Rust `search` command:
   - Calls `api.search(query, None)` → 20 songs, no top_album.
   - Because filter is None, ALSO fires `api.search(query, Some(ALBUMS_FILTER))`.
   - Parses that response, picks `max_by_key(year)` MPRE album. Sets
     `result.top_album`.
   - Logs: `top_album=Some(("太陽之子", "2026", "MPREb_yBTLlVG2D4V"))`.
   - Returns.
6. Frontend receives results. `topAlbum = results.topAlbum`.
7. Lazy-fetch effect sees topAlbum.browseId change → calls
   `browseApi.getPlaylist(browseId)`. Caches response. Stores into
   `topAlbumPreview`.
8. Cover decode effect: `new Image(); src = topAlbum.artworkUrl;
   await .decode()`. Sets `topCoverReady = true`.
9. All four gate conditions now true → Top result shelf renders in one
   shot with cover + 3 preview tracks. Songs shelf renders below.

### 8.4 Toggle Now Playing overlay
1. User clicks the player-bar cover (or 𝄢 button).
2. `App.tsx::toggleNowPlaying` — checks `Date.now() - lastToggleAtRef.current < 450`;
   if yes, ignore. Else update ref, flip state.
3. `NowPlaying`'s opacity + transform transition runs (420 ms cubic-bezier).
4. User clicks cover again → same flow → overlay fades out.
5. User navigates to another tab → `onNavigate` in AppShell also calls
   `setIsNowPlayingOpen(false)` → overlay auto-hides.

### 8.5 Playlist detail → back to search
1. User searches, clicks an album → `setViewingPlaylist({ id, autoPlay: false })`.
2. App.tsx renders SearchPage underneath, PlaylistDetailPage on top
   (overlay div with `background: var(--color-bg)`).
3. SearchPage stays mounted — its `useState` for query, submittedQuery,
   results, caches, scroll position — all preserved.
4. User clicks Back in the detail page → `setViewingPlaylist(null)` →
   overlay unmounts → SearchPage is now visible with the exact state they
   left it in.

---

## 9. Non-Functional Requirements

- **Zero layout shift** — all images have `width`/`height` or `aspectRatio`.
- **Zero half-painted images** — every image goes through `CachedImage`
  which pre-decodes. Raw `<img>` tags are banned in user-facing components.
- **No default text selection** — only form fields are selectable.
- **No "selecting" hover cursor** — body sets `cursor: default`; buttons
  set `cursor: pointer`; inputs set `cursor: text`.
- **Responsive to window resize** — every layout uses flex or grid, no
  fixed pixel widths except component-local artwork sizes.
- **Safe concurrent IPC** — `ytm_api_call` uses a per-request slot; poller
  uses a separate slot; neither contends with user-initiated calls.
- **No unnecessary reloads** — SearchPage caches per (query, category);
  HomePage caches for 30 min; album preview cached by browseId.
- **Perceived latency** — all playback controls use optimistic UI + 150 ms
  poller + synchronous bridge state writes.

---

## 10. Build & Run

### 10.1 `package.json` scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "typecheck": "tsc --noEmit"
  }
}
```

### 10.2 Commands

```bash
pnpm install
pnpm tauri dev     # development with HMR
pnpm tauri build   # produces a signed .app in src-tauri/target/release/bundle/
pnpm typecheck     # zero errors required
cd src-tauri && cargo check     # zero errors required
```

### 10.3 `src-tauri/tauri.conf.json` essentials

- `productName: VibeYTM`
- `identifier: com.vibeytm.app`
- `build.devUrl: http://localhost:1420`
- `build.frontendDist: ../dist`
- `app.windows[0]`: 1200×800, min 900×600, macOS titleBarStyle: Overlay,
  hiddenTitle: true
- `app.security.csp: null`
- `app.security.assetProtocol: { enable: true, scope: ["$APPDATA/**", "$APPLOCALDATA/**"] }`
- `plugins.deep-link.desktop.schemes: ["vibeytm"]`

---

## 11. Known Gotchas (must-read for future me)

1. **`fetch()` from our own frontend hits CORS**. That's why we eval
   `fetch()` inside the YTM window context via `evaluateJavaScript`.
2. **Google sign-in blocks Chrome-spoofed WebViews**. Use a Safari user
   agent for the hidden YTM window.
3. **`cargo run` (tauri dev) doesn't auto-reload Rust changes** unless you
   kill and restart tauri dev. Rust edits → kill tauri dev → run again.
4. **React 18 StrictMode double-invokes state updaters** in dev. This is
   harmless — both invocations receive the same `prev` and return the same
   next value.
5. **`user-select: none` on body disables text selection app-wide**. Add
   the form-field exception rule, or the search bar won't work.
6. **`display: block` on a marquee inner element won't slide**. The inner
   must be `display: inline-block` so its width equals content width;
   only then does `translateX` visibly move text.
7. **Backdrop-filter on an opaque background paints the element itself
   blurred** in some WebKit builds. Don't combine them.
8. **Album browseIds start with `MPRE`; playlist IDs don't**. A generic
   "is it an album" check must filter on prefix.
9. **Top result card's browseId is at `onTap.browseEndpoint.browseId`**,
   not `navigationEndpoint.browseEndpoint.browseId`.
10. **The unfiltered search rarely contains the latest album**. Fire a
    parallel album-filtered search and pick `max_by_key(year)`.
11. **Card click propagation**: the play-button overlay inside AlbumCard
    must have `pointer-events: none` on the darkening div; only the play
    button itself catches clicks; it must `stopPropagation`. Otherwise
    only the first card in a grid is clickable (React key collision side
    effect magnified by the overlay eating clicks).
12. **PlaylistDetailPage must not unmount SearchPage on open**. Render it
    as an absolute-positioned overlay in App.tsx, not in place.
13. **Rapid-click debounce the NowPlaying toggle** (450 ms) so a double
    click doesn't flash open-and-close.
14. **The poller interval and bridge update interval should match
    (150 ms)** — otherwise reads can miss optimistic state writes.

---

## 12. Acceptance Criteria

The build is done when:

- [ ] `pnpm tauri dev` launches two windows: the app UI and a hidden YTM
      window (Safari UA).
- [ ] Signing into YTM once persists across restarts.
- [ ] Home page loads 10+ shelves (with continuation).
- [ ] Clicking an album cover opens detail; clicking the play button plays
      the first track and opens detail.
- [ ] Search bar only searches on Enter or suggestion click.
- [ ] Typing 3+ chars shows up to 5 autocomplete suggestions.
- [ ] ↓/↑ cycles through suggestions; Enter submits highlighted.
- [ ] Unified search view shows the latest album (by year) on the left with
      3 preview tracks on the right; renders in one shot (no flash).
- [ ] Toggling search tabs is instant (cache hit); clicking the active
      tab returns to the unified view.
- [ ] Back from a playlist detail returns to search with query and
      results intact.
- [ ] Clicking the player-bar cover opens the now-playing overlay; clicking
      again closes it; auto-closes on sidebar nav.
- [ ] Now-playing cover fills the window while leaving room for the title
      block underneath.
- [ ] Play, pause, next, previous, shuffle, repeat, like all work and
      update within ~150 ms perceived.
- [ ] Long titles in SongRow / PlayerBar marquee on hover and stop when
      the full text is visible.
- [ ] Disk cache grows as you browse; Settings → Cache shows live stats;
      Clear empties the disk cache.
- [ ] No text is selectable anywhere except the search input.
- [ ] No image ever appears half-painted.
- [ ] `pnpm typecheck` and `cargo check` both pass with zero errors.

---

## 13. What to build first (suggested order)

1. Scaffolding: `pnpm create tauri-app` (React + TS), wire up pnpm.
2. Design tokens + global CSS.
3. AppShell + Sidebar stubs with hardcoded pages.
4. Hidden YTM window + Safari UA + bridge injection.
5. Bridge JS (`__VIBEYTM_STATE__` + `__VIBEYTM_COMMAND__`).
6. Rust poller reading state → PlayerState → Tauri events.
7. PlayerBar (track info + transport + optimistic toggles).
8. Basic playerApi.playTrack via SPA navigation.
9. YTM API parsers: `search`, `get_home`, `get_playlist`.
10. CachedImage + SongRow + AlbumCard + ShelfRow.
11. HomePage (simple shelf rendering).
12. SearchPage (basic search, tabs).
13. PlaylistDetailPage.
14. Disk cache + Settings.
15. NowPlaying overlay.
16. MarqueeText + integration.
17. Latest-album selection + top-result unified view.
18. Shuffle / repeat / like through bridge.
19. Autocomplete + arrow keys.
20. Final polish: animations, user-select rules, rapid-click lockouts,
    sticky headers.

Build each step on top of the last; validate after each with `pnpm
typecheck` and `cargo check` (both must stay green).

---

END OF SPEC.
