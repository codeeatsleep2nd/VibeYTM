# YouTube Music Mac App: Feasibility & Options Research Report

*Generated: 2026-04-10 | Sources: 25+ | Confidence: High*

## Executive Summary

Building a Mac app for YouTube Music is **highly feasible** — in fact, there's a thriving ecosystem of open-source projects already doing this. The core approach is wrapping YouTube Music's web player (`music.youtube.com`) in a desktop shell with native OS integrations. You have three viable technology paths: **native Swift/SwiftUI** (best Mac experience), **Electron** (most mature ecosystem), or **Tauri** (modern, lightweight). Multiple successful open-source projects exist that you could fork, learn from, or compete with.

---

## 1. Existing Projects — The Competitive Landscape

There are already several actively maintained YouTube Music desktop apps:

### Tier 1: Major Projects

| Project | Tech | Stars | Status | macOS Support |
|---------|------|-------|--------|---------------|
| [**Pear Desktop**](https://github.com/pear-devs/pear-desktop) (formerly th-ch/youtube-music) | Electron + TypeScript | **31,193** | Active (v3.11, Sep 2025) | Yes |
| [**YTMDesktop**](https://github.com/ytmdesktop/ytmdesktop) | Electron + TypeScript + Vue | **5,793** | Active (v2.0.11, Feb 2026) | Yes |
| [**Kaset**](https://github.com/sozercan/kaset) | Swift + SwiftUI | **886** | Active (v0.8.2, Mar 2026) | macOS-only |
| [**ytmdesktop2**](https://github.com/Venipa/ytmdesktop2) (by Venipa) | Electron + Vue3 | **890** | Active (v0.18.9, Mar 2026) | Yes |

### Tier 2: Smaller / Niche Projects

| Project | Tech | Stars | Notes |
|---------|------|-------|-------|
| [0xjemm/youtube-music-macos](https://github.com/0xjemm/youtube-music-macos) | Swift (WebKit) | 21 | Lightweight, native macOS, Discord RPC |
| [vedant-sharmaa/ytm-wrapper](https://github.com/vedant-sharmaa/ytm-wrapper) | Electron | 6 | Simple wrapper with background playback |
| [deeffest/YouTube-Music-Desktop-Player](https://github.com/deeffest/Youtube-Music-Desktop-Player) | Python + QtWebEngine | 21 | Cross-platform, plugin system |

### Key Takeaway

Pear Desktop (31K stars) is the dominant player — it has a plugin framework, ad blocking, Discord RPC, Last.fm, and a huge contributor base. **Kaset** is the most interesting native Mac option — it uses SwiftUI with Liquid Glass design, Apple Intelligence integration, and proper Now Playing/Control Center support.

---

## 2. Technology Options

### Option A: Native Swift + SwiftUI + WKWebView (Recommended for Mac-only)

**How it works:** Use `WKWebView` to load `music.youtube.com`, inject JavaScript to extract playback state, and bridge to native macOS APIs.

| Pros | Cons |
|------|------|
| Smallest footprint (~5-15 MB) | macOS only |
| Native Now Playing, media keys, Control Center | Must write JS bridge for playback state |
| Liquid Glass / native UI integration | Smaller community, fewer examples |
| No Chromium or Node.js bundled | WKWebView quirks (DRM, some web APIs) |
| Best battery / memory performance | Swift knowledge required |

**Reference:** Kaset (886 stars) and 0xjemm/youtube-music-macos (21 stars) both prove this works. Kaset even supports DRM-protected YouTube Music Premium content via WKWebView.

**DRM note:** WKWebView on macOS supports DRM playback (Kaset confirms this), so Premium content playback works.

### Option B: Electron (Most Proven)

**How it works:** Bundles Chromium + Node.js. Your app is essentially a custom Chrome window with full Node.js backend capabilities.

| Pros | Cons |
|------|------|
| Largest ecosystem, most examples | 80-150 MB bundle size |
| Full Chromium compatibility | 150-300 MB RAM at idle |
| Cross-platform (Win/Mac/Linux) | Battery drain concerns |
| Plugin systems already built | "Another Electron app" fatigue |
| npm ecosystem for everything | Not notarizable without Apple Developer account |

**Reference:** Pear Desktop (31K stars), YTMDesktop (5.8K stars) — both are mature, production-quality Electron apps.

### Option C: Tauri + Rust (Modern Middle Ground)

**How it works:** Uses the OS native WebView (WKWebView on macOS) + Rust backend. Frontend can be React/Vue/Svelte.

| Pros | Cons |
|------|------|
| 3-10 MB bundle size | WebKit quirks on macOS (same as Swift) |
| ~30 MB RAM at idle | Rust knowledge needed for backend |
| Cross-platform + mobile support | Smaller ecosystem than Electron |
| Strong security model | Some community reports of WebKit bugs |
| Modern architecture | Fewer YouTube Music examples to reference |

**2026 benchmark data** ([tech-insider.org](https://tech-insider.org/tauri-vs-electron-2026/)):

| Metric | Tauri 2.x | Electron 34.x |
|--------|-----------|----------------|
| Bundle size | 3.2 MB | 85 MB |
| Cold start | 0.4-0.8s | 1.8-3s |
| RAM (idle) | 25-50 MB | 150-250 MB |

---

## 3. Core Technical Challenges

### Extracting Playback State

YouTube Music's web player exposes an internal player API. All existing projects use **JavaScript injection** to:

- Get current track info (title, artist, album, artwork URL)
- Get playback state (playing/paused, progress, duration)
- Control playback (play, pause, next, previous, seek)

The [YTM Beautifier](https://github.com/nwvbug/YouTubeMusic-Beautifier) project documents the approach: a content script uses `MutationObserver` to watch for state changes, and a bridge script accesses YTM's internal player API.

### Media Key Integration

- **macOS:** Use `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter` to register as a media player. This enables Control Center integration, media keys, and AirPlay display.
- Both Kaset and 0xjemm/youtube-music-macos demonstrate this working with Swift.

### DRM Content (YouTube Music Premium)

- WKWebView on macOS supports DRM playback (Kaset confirms this)
- Electron/Chromium has full Widevine support
- This is not a blocker for any approach

### Unofficial API

- [**ytmusicapi**](https://github.com/sigma67/ytmusicapi) (2,567 stars) — Python library that emulates YouTube Music web requests. Useful for library management, playlist operations, search — but **not for playback** (playback must go through the web player).

---

## 4. Legal / TOS Considerations

- YouTube Music is **licensed for personal, non-commercial use only** ([sound-machine.com](https://sound-machine.com/blog/2025/07/09/is-youtube-music-legal-for-business-use/))
- All major projects include disclaimers: *"not affiliated with YouTube or Google Inc."*
- Google has **not taken action** against any of the major open-source wrappers (Pear Desktop has 31K stars and has been active since 2019)
- Projects are licensed under MIT, GPL-3.0, or Apache 2.0
- **Risk level: Low** for a personal/open-source project that wraps the web player without circumventing ads or DRM. Higher risk if you strip ads or bypass Premium requirements.
- Google could theoretically send DMCA/cease-and-desist, but has shown no pattern of doing so for wrapper apps

---

## 5. Key Features Users Want

Based on analysis of existing projects, issues, and feature lists:

| Feature | Priority | Difficulty |
|---------|----------|------------|
| Background playback (keep playing when window closes) | Must-have | Easy |
| Media key support (play/pause/next/prev) | Must-have | Medium |
| Now Playing in Control Center + Lock Screen | Must-have | Medium |
| System tray / Dock menu controls | Must-have | Easy |
| Track change notifications | Should-have | Easy |
| Ad blocking | Nice-to-have | Easy (JS injection) |
| Custom CSS themes | Nice-to-have | Easy |
| Keyboard shortcuts (global hotkeys) | Should-have | Medium |
| Mini player mode | Nice-to-have | Medium |
| Lyrics display | Nice-to-have | Hard |
| Apple Intelligence integration | Differentiator | Hard |
| URL scheme (`myapp://play?v=ID`) | Nice-to-have | Easy |

---

## 6. Recommended Approach

Given that you're building specifically for **Mac**, here are ranked recommendations:

### Recommendation 1: Fork or Learn from Kaset (Swift + SwiftUI)

- **Why:** Native Mac app, Liquid Glass UI, Apple Intelligence, proper Now Playing integration, 886 stars, MIT licensed, actively maintained, has CLAUDE.md for AI contributions
- **Effort:** Fork and customize, or study its architecture and build your own
- **Differentiator potential:** High — you'd be building on the best native Mac foundation

### Recommendation 2: Build from Scratch with Swift + WKWebView

- **Why:** Full control, learn the internals, smallest footprint
- **Reference:** 0xjemm/youtube-music-macos shows a minimal working implementation in pure Swift
- **Effort:** Medium — the core (WebView + JS bridge + Now Playing) is ~1-2 weeks for an experienced Swift developer

### Recommendation 3: Use Electron (if cross-platform matters)

- **Why:** Fastest path to MVP, massive ecosystem, proven with YouTube Music
- **Reference:** Fork Pear Desktop or YTMDesktop
- **Effort:** Low — these are production-ready apps you can customize

### Recommendation 4: Use Tauri (if you want modern + cross-platform)

- **Why:** Best of both worlds — small bundle, uses WKWebView on Mac, cross-platform
- **Caveat:** Some developers report WebKit pain points on macOS; fewer YouTube Music examples exist
- **Effort:** Medium — you'd be pioneering this approach for YouTube Music

---

## Sources

1. [Pear Desktop (31K stars)](https://github.com/pear-devs/pear-desktop) — Dominant Electron-based YouTube Music app
2. [YTMDesktop (5.8K stars)](https://github.com/ytmdesktop/ytmdesktop) — Mature Electron app with companion server
3. [Kaset (886 stars)](https://github.com/sozercan/kaset) — Native SwiftUI YouTube Music client
4. [ytmdesktop2 (890 stars)](https://github.com/Venipa/ytmdesktop2) — Electron + Vue3 with Discord/Last.fm
5. [0xjemm/youtube-music-macos (21 stars)](https://github.com/0xjemm/youtube-music-macos) — Minimal native Swift wrapper
6. [ytmusicapi (2.6K stars)](https://github.com/sigma67/ytmusicapi) — Python unofficial API for YouTube Music
7. [Tauri vs Electron 2026](https://tech-insider.org/tauri-vs-electron-2026/) — Comprehensive framework comparison
8. [PkgPulse: Tauri vs Electron vs Neutralino](https://www.pkgpulse.com/blog/tauri-vs-electron-vs-neutralino-desktop-apps-javascript-2026) — Benchmark data
9. [Reddit: Tauri WebKit pain points](https://www.reddit.com/r/javascript/comments/1q6hts7/) — Real-world Tauri experience report
10. [YouTube Music business use legality](https://sound-machine.com/blog/2025/07/09/is-youtube-music-legal-for-business-use/) — TOS analysis
11. [YTM Beautifier](https://github.com/nwvbug/YouTubeMusic-Beautifier) — Chrome extension documenting YTM internal player API access
12. [vedant-sharmaa/ytm-wrapper](https://github.com/vedant-sharmaa/ytm-wrapper) — Simple Electron macOS wrapper
13. [YouTube Music Desktop Player (Python)](https://github.com/deeffest/Youtube-Music-Desktop-Player) — QtWebEngine-based player
14. [YTMDesktop feature comparison](https://blog.brightcoding.dev/2026/03/14/ytmdesktop-the-revolutionary-youtube-music-client-developers-love) — Feature analysis
15. [YouTube Music official device support](https://support.google.com/youtubemusic/answer/9231765) — Google's supported integrations

## Methodology

Searched 5 sub-questions across web and GitHub. Analyzed 25+ sources including GitHub repositories, comparison articles, Reddit discussions, and official documentation. Deep-read key repositories (Kaset, 0xjemm) for architecture details.
