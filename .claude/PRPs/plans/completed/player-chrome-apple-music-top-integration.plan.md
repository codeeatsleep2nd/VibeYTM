# Plan: Player Chrome — Apple Music Top-Integrated Layout

## Summary
Replace the bottom `PlayerBar` with a top-integrated `PlayerChrome` that fuses with the Tauri title bar — matching Apple Music's macOS player exactly. The chrome is one ~56px-tall horizontal strip running across the top of the window: traffic-light reservation on the far left, then a row of flat SVG transport icons (no filled circles), then a centered rounded "Now Playing display" card with embedded cover + title + artist + times + 2px progress bar, then small utility icons on the right (volume, like, lyrics, queue). All existing optimistic-update, planned-next/prev, preload, seek-while-paused, and bridge-volume-lock behavior is preserved.

## User Story
As a desktop music listener using a self-described "Apple Music-style YouTube Music app," I want the player chrome to actually look like Apple Music — top of the window, flat SF-Symbol-style icons, the signature rounded Now-Playing display card in the middle — so the app's identity holds at the most-looked-at surface.

## Problem → Solution
**Current**: A 72px bottom bar with mixed-weight Unicode glyphs, a high-contrast white play pill, three disconnected horizontal regions (cover button | title column | progress slider | volume slider | toggle buttons), and a duplicate Now-Playing toggle. Title bar is a separate empty 38px drag strip. Looks more like Spotify than Apple Music.

**Desired**: A single 56px top chrome integrated with the title bar:
- Far left: 80px reserved for macOS traffic-light buttons (Tauri `titleBarStyle: "Overlay"` overlays them).
- Left: 5 flat SVG transport icons (shuffle, prev, play, next, repeat) — no backgrounds, no scale-on-hover, no filled circles. Play uses a heavier glyph at slightly larger size; otherwise siblings have identical visual weight.
- Center: a rounded `--color-surface-2` card (~520-640px wide) bundling 36px cover + title + artist + elapsed/remaining time stack + 2px progress bar embedded along the bottom edge — the Apple Music "Now Playing display" widget.
- Right: 4 small flat utility icons — speaker glyph + slim volume slider, ♡ like, lyrics (LRC), queue (☰) — same monochrome treatment as transports.
- Empty negative space between regions is the Tauri window-drag region (handled at the chrome level, not as a separate overlay).

## Metadata
- **Complexity**: Large
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 9 (3 new, 6 modified, 1 deleted)

---

## UX Design

### Before
```
Window:
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  ⓧⓨⓩ                              (empty 38px drag strip)                                 │ ← title bar
├─────────────────────────────────────────────────────────────────────────────────────────┤
│         │                                                                                │
│  Side   │                  Main content area                                            │
│  bar    │                                                                                │
│         │                                                                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  ●  [▦] Title    ⇋ ⏮ [▶] ⏭ ↻      0:32 ───────── 4:18      ♡ ♪──── LRC ☰ 𝄢            │ ← 72px bottom PlayerBar
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### After
```
Window:
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ ⓧⓨⓩ  ⤨ ◀◀ ▶ ▶▶ ↻    ┌─────────────────────────────────────┐    🔈─── ♡  LRC  ☰        │ ← 56px PlayerChrome
│ 80px  flat SVG       │ [▦] 千千闕歌                  0:32 │   small flat utility icons  │   integrated with
│ traffic              │ [▦] 陳慧嫻 — 飄雪              4:18 │   tertiary at rest          │   title bar
│ lights               │ [▦] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │                             │
│                      └─────────────────────────────────────┘                              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│         │                                                                                │
│  Side   │                  Main content area (now reaches the bottom of the window)     │
│  bar    │                                                                                │
│         │                                                                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Player chrome position | Bottom (72px) | Top (56px), integrated with title bar | Apple Music match |
| Title bar | Empty 38px drag strip | Replaced by chrome (chrome contains the drag region in its negative space) | One physical strip instead of two |
| Bottom of window | Reserved 72px for bar | Free; main content extends to the bottom | More viewport for content |
| Play button | White-pill 40px | Flat SVG triangle, 28px, no background | AM uses no fill |
| All transport buttons | Unicode glyphs of mixed weights, hover scale 1.15 | Inline SVG (SF-Symbol-equivalent), hover color brighten only, NO scale | AM is restrained |
| Now Playing card | 3 separate elements | 1 unified rounded `--color-surface-2` widget with embedded progress | The signature AM pattern |
| Like (♡) | Right cluster, between heart and volume | Right cluster, between volume and LRC (smaller) | Same physical area, smaller weight |
| Lyrics button | Right cluster, "LRC" text | Right cluster, lyrics SVG (text bubble) | Icon, not text |
| Queue toggle | Right cluster, ☰ glyph | Right cluster, list-bullet SVG | Icon, consistent weight |
| Now-Playing toggle (𝄢) | Right cluster duplicate | Removed; click the cover thumbnail in the center card | One entry point |
| Volume slider | 80px stub with static ♪ glyph | Slim 88px slider with dynamic 🔇/🔈/🔊 SVG glyph | Same hover-reveal pattern |
| Window-drag region | Separate overlay div above bar | Built into chrome; spans only empty space, not buttons | Tauri-native pattern |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `src/components/layout/PlayerBar.tsx` | all 720 | Source of every behavior the new chrome must preserve (preload effect, optimistic updates, planned-next/prev, seek workarounds, volume lock client side) |
| P0 (critical) | `src/components/layout/AppShell.tsx` | all 85 | Where the bottom PlayerBar is mounted today and where the top chrome will replace the title-bar drag div |
| P0 (critical) | `src/styles/tokens.css` | all 62 | Tokens drive both the chrome and overlay positioning; this plan retags `--title-bar-height` and `--player-bar-height` |
| P0 (critical) | `src-tauri/tauri.conf.json` | 12-24 | Confirms `titleBarStyle: "Overlay"` + `hiddenTitle: true` — traffic lights overlay the content, so the chrome must reserve ~80px on the left |
| P1 (important) | `src/components/player/NowPlaying.tsx` | 70-90, 245-250, 320-330 | Reads `var(--title-bar-height)` and `var(--player-bar-height)` for positioning math; both tokens stay defined but their values change |
| P1 (important) | `src/components/player/QueuePanel.tsx` | 605-625 | Same — reads both tokens for fixed positioning |
| P1 (important) | `src/lib/ipc.ts` | search `playerApi`, `getPlannedNext`, `getPlannedPrevious`, `setPredictedTrack`, `getActivePlaylistId`, `cacheApi`, `browseApi` | Every API the new chrome calls — preserve every call |
| P1 (important) | `src/hooks/usePlayerState.ts` | search `applyOptimistic`, `markSeek` | Contract is unchanged: optimistic before IPC, revert on `.catch` |
| P2 (reference) | `src/components/MarqueeText.tsx` | all | Title in the Now-Playing card uses MarqueeText — must stay in a `minWidth: 0` flex parent |
| P2 (reference) | `src/components/CachedImage.tsx` | all | Cover image preserves `width`/`height` props |
| P2 (reference) | `src/styles/global.css` | all 119 | Where Apple-Music slider pseudo-element CSS goes |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Apple Music macOS player | Apple Music app visual reference | Single top strip ~56px tall; transport icons flat with no backgrounds; play is heavier-weight same shape, no filled pill; Now Playing display is one rounded card with cover + title + artist + times + thin embedded progress bar; right cluster is small monochrome utility icons |
| SF Symbols visual reference | Apple SF Symbols app | Source-of-truth shapes for `shuffle.fill`, `backward.fill`, `play.fill`, `pause.fill`, `forward.fill`, `repeat`, `repeat.1`, `heart`/`heart.fill`, `text.bubble`/`text.bubble.fill`, `list.bullet`, `speaker.slash.fill`, `speaker.wave.1.fill`, `speaker.wave.2.fill` |
| Tauri title-bar overlay | `tauri.conf.json` already sets `titleBarStyle: "Overlay"` + `hiddenTitle: true` | Traffic-light buttons overlay the content area at the top-left; macOS positions them at ~`x: 12-72, y: 12-30`. Reserve 80px of left padding in the chrome so they don't collide with the shuffle button |
| `data-tauri-drag-region` | Tauri docs | Any element with this data attribute becomes a window drag handle. CHILDREN of a drag region are NOT draggable by default (clicks propagate). Buttons inside a drag region work normally |
| WKWebView range pseudo-elements | MDN `::-webkit-slider-thumb`, `::-webkit-slider-runnable-track` | Both `<input>` and the thumb need `appearance: none` for the hover-reveal pattern |

GOTCHA — Tauri drag region: `data-tauri-drag-region` ancestors capture mousedown for window-drag. **Real `<button>`s inside a drag-region element still receive clicks** in current Tauri versions, but inline SVG icons WITHOUT a `<button>` wrapper will be eaten by the drag handler. Keep every interactive icon wrapped in `<button>` (which the project's CLAUDE.md WKWebView rule already requires).

GOTCHA — macOS traffic lights are 80px on the left at `decorations: true` + `titleBarStyle: "Overlay"`. The chrome's left padding must be `80px`, not `var(--space-4)`, to avoid collisions on macOS. (On Windows/Linux this padding is wasted but harmless — the project is macOS-first.)

GOTCHA — `--player-bar-height` is read by NowPlaying (line 74) AND QueuePanel (line 612) AND in arithmetic on lines 248, 326, 613 of those files. Setting it to `0px` (instead of removing it) lets all that math collapse correctly without touching either component.

---

## Patterns to Mirror

### NAMING_CONVENTION
```tsx
// SOURCE: src/components/layout/PlayerBar.tsx:50-82
const TransportButton: FC<{ ... }> = (...) => (...)
```
Keep the inner-component pattern. New file uses: `TransportButton`, `UtilityButton`, `NowPlayingCard`, `Slider`. All `FC<Props>` typed.

### OPTIMISTIC_UPDATE_PATTERN (do NOT change semantics)
```tsx
// SOURCE: src/components/layout/PlayerBar.tsx:276-283
const handleTogglePlay = () => {
  applyOptimistic({ status: isPlaying ? 'paused' : 'playing' });
  playerApi.togglePlay().catch(() => {
    applyOptimistic({ status: isPlaying ? 'playing' : 'paused' });
  });
};
```
Every transport handler in the new code keeps this shape: optimistic first, IPC second, `.catch` reverts.

### PLANNED-NEXT/PREV PATTERN (load-bearing — do NOT change)
```tsx
// SOURCE: src/components/layout/PlayerBar.tsx:482-492
onClick={() => {
  const next = getPlannedNext();
  if (next?.videoId) {
    setPredictedTrack(next);
    applyOptimistic({ track: next, positionSecs: 0 });
    const pl = getActivePlaylistId() ?? undefined;
    playerApi.playTrack(next.videoId, pl).catch(() => {});
  } else {
    playerApi.next();
  }
}}
```
This is what makes QueuePanel's now-playing-bars animation land instantly. New prev/next handlers MUST `setPredictedTrack` BEFORE the IPC.

### PRELOAD EFFECT (load-bearing — copy verbatim)
```tsx
// SOURCE: src/components/layout/PlayerBar.tsx:168-263
const currentVideoId = track?.videoId;
useEffect(() => {
  if (!currentVideoId) return;
  let cancelled = false;
  const timer = setTimeout(() => {
    if (cancelled) return;
    // ... cache-first cover + lyrics preload via planned-next OR getUpcomingTracks fallback
  }, 2000);
  return () => { cancelled = true; clearTimeout(timer); };
}, [currentVideoId]);
```
The 2-second deferral is critical — firing background fetches at the same moment as the YTM webview navigates saturates the bridge channel and starves user-driven IPCs (per CLAUDE.md "Background fetches need a settle delay" rule). Copy the whole effect verbatim into the new chrome component.

### TOKEN-ONLY STYLING
```tsx
// SOURCE: src/components/layout/PlayerBar.tsx:319-326
height: 'var(--player-bar-height)',
background: 'var(--color-surface-1)',
borderTop: '1px solid oklch(100% 0 0 / 0.06)',
padding: '0 var(--space-4)',
zIndex: 100,
```
Every dimension and color references a token. Allowed inline literals: alpha-only `oklch(100% 0 0 / N)` overlays; the `80px` traffic-light reservation (no semantic token); the inline `background: linear-gradient(...)` on slider inputs (drives the progress fill).

### REAL `<button>` ELEMENTS (CLAUDE.md WKWebView rule)
All click targets MUST be `<button>` — never `<div role="button">`. Verified pattern: `src/components/layout/PlayerBar.tsx:447-470`. The new chrome has more icons than today; every single one is a `<button>`.

### MARQUEE WRAPPER
```tsx
// SOURCE: src/components/layout/PlayerBar.tsx:388-407
<div style={{ minWidth: 0, flex: 1 }}>
  <MarqueeText text={track.title} ... />
  ...
</div>
```
Title in the Now Playing card stays in a `minWidth: 0` flex parent so MarqueeText overflow detection still works.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/components/icons/index.tsx` | CREATE | Inline SVG icon library matching SF Symbols (single file, ~14 icons) |
| `src/components/layout/PlayerChrome.tsx` | CREATE | The new top-integrated chrome component (replaces PlayerBar in AppShell) |
| `src/components/player/NowPlayingCard.tsx` | CREATE | The rounded "Now Playing display" widget used inside PlayerChrome |
| `src/components/layout/PlayerBar.tsx` | DELETE | Replaced by PlayerChrome; no other importers (verified — only AppShell mounts it) |
| `src/components/layout/AppShell.tsx` | UPDATE | Remove the title-bar drag div, mount PlayerChrome at the top, drop bottom PlayerBar mount, drop bottom padding from `<main>` |
| `src/styles/tokens.css` | UPDATE | `--title-bar-height: 56px` (was 38), `--player-bar-height: 0px` (was 72) |
| `src/styles/global.css` | UPDATE | Append Apple-Music range CSS (`data-vibeytm-slider` attribute selector) |
| `src/components/player/NowPlaying.tsx` | NO CHANGE (verify only) | Reads `--title-bar-height` and `--player-bar-height` — math still works once tokens collapse |
| `src/components/player/QueuePanel.tsx` | NO CHANGE (verify only) | Same — reads both tokens; new values are correct |

## NOT Building

- **No new icon library** (lucide-react, phosphor, etc.). Inline SVG keeps bundle size flat and gives pixel-perfect control over each path.
- **No theme system / light mode** — the project is dark-only.
- **No changes to Sidebar** — it stays at `var(--sidebar-width)`, but its top now starts beneath the chrome. Confirm visually after the change.
- **No changes to NowPlaying or QueuePanel internals** — only their inputs (the tokens) change. They auto-adjust.
- **No keyboard shortcuts changes**.
- **No changes to IPC layer, hooks, Rust, or bridge**.
- **No drag-to-resize or window-snapping changes** — Tauri title-bar style stays as configured.
- **No reordering of utility icons** beyond what's in the after-mockup. (e.g. AirPlay icon is NOT being added — the project doesn't have AirPlay support.)
- **No volume-mute click on the speaker glyph** — separate feature.
- **No hover-reveal seek tooltip** — separate plan.
- **No "View as full screen" / mini-player toggles** — separate features.

---

## Step-by-Step Tasks

### Task 1: Create the SVG icon library
- **ACTION**: Create `src/components/icons/index.tsx` containing inline SVG icon components.
- **IMPLEMENT**: Single file exporting all icons as named React components. Each icon is a 24×24 viewBox `<svg>` with `fill="currentColor"` (so the parent `color` token tints it). Use SF Symbols visual reference for paths.

```tsx
// SOURCE: src/components/icons/index.tsx (NEW)
import { type FC, type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const wrap = (size = 24): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: false,
});

// Shuffle — two crossing arrows
export const ShuffleIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M16 3h5v5l-1.5-1.5L4.5 21.5 3 20 18 5l-2-2zm0 18 2-2-3.5-3.5 1.5-1.5L19 17.5V13h2v8h-8l1.5-1.5L11 16l-3-3-1.5 1.5L3 11l1.5-1.5L8 13l3 3 5 5z" />
  </svg>
);

// Backward — double left triangle
export const PrevIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M6 4h2v16H6V4zm14 1.5v13L9.5 12 20 5.5z" />
  </svg>
);

// Forward — double right triangle
export const NextIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M16 4h2v16h-2V4zM4 5.5 14.5 12 4 18.5v-13z" />
  </svg>
);

// Play — solid filled triangle (no circle)
export const PlayIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M6 4.5v15L19 12 6 4.5z" />
  </svg>
);

// Pause — two solid bars with rounded ends
export const PauseIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <rect x="6" y="4" width="4" height="16" rx="1.2" />
    <rect x="14" y="4" width="4" height="16" rx="1.2" />
  </svg>
);

// Repeat — TWO HORIZONTAL ARROWS pointing opposite ways (Apple Music's `repeat`).
// NOT a circular arrow with a gap — that's `arrow.clockwise` (reload), a different
// SF Symbol. The Apple Music repeat is two stacked horizontal bars, top bar
// pointing right with arrowhead at the right end, bottom bar pointing left with
// arrowhead at the left end. Verified against SF Symbols app.
export const RepeatIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    {/* top arrow: bar going right, arrowhead at right end */}
    <rect x="3" y="7" width="14" height="2" rx="1" />
    <path d="M16 5 L21 8 L16 11 z" />
    {/* bottom arrow: bar going left, arrowhead at left end */}
    <rect x="7" y="15" width="14" height="2" rx="1" />
    <path d="M8 13 L3 16 L8 19 z" />
  </svg>
);

// Repeat one — same two arrows + a "1" sitting in the visual gap between them.
// Apple Music's `repeat.1` is the SAME two-arrow shape with a small numeric "1"
// rendered between the bars — NOT inside any loop (there is no loop).
export const RepeatOneIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <rect x="3" y="6" width="14" height="2" rx="1" />
    <path d="M16 4 L21 7 L16 10 z" />
    <rect x="7" y="16" width="14" height="2" rx="1" />
    <path d="M8 14 L3 17 L8 20 z" />
    <text x="12" y="14.2" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor">1</text>
  </svg>
);

// Heart — outline
export const HeartIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M12 21s-7-4.5-9.5-9C1 9 2.5 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3 4 0 5.5 4 4 7-2.5 4.5-9.5 9-9.5 9zm0-2.5c1.7-1.2 6.5-4.7 8-7.5 1-1.9 0-4-2-4-1.5 0-2.7.7-4.6 2.6L12 11l-1.4-1.4C8.7 7.7 7.5 7 6 7c-2 0-3 2.1-2 4 1.5 2.8 6.3 6.3 8 7.5z" />
  </svg>
);

// Heart filled
export const HeartFillIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M12 21s-7-4.5-9.5-9C1 9 2.5 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3 4 0 5.5 4 4 7-2.5 4.5-9.5 9-9.5 9z" />
  </svg>
);

// Lyrics — text bubble (text.bubble.fill)
export const LyricsIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M4 4h16c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2h-7l-5 4v-4H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm3 4v1.5h10V8H7zm0 3.5V13h10v-1.5H7zm0 3.5v1.5h7V15H7z" />
  </svg>
);

// Queue — list bullet
export const QueueIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M3 6h2v2H3V6zm4 .5h14v1.5H7V6.5zM3 11h2v2H3v-2zm4 .5h14V13H7v-1.5zM3 16h2v2H3v-2zm4 .5h14V18H7v-1.5z" />
  </svg>
);

// Speaker — muted (speaker.slash.fill)
export const SpeakerMuteIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M3 9v6h4l5 4V5L7 9H3zm14 1.5L19.5 8 21 9.5 18.5 12 21 14.5 19.5 16 17 13.5 14.5 16 13 14.5 15.5 12 13 9.5 14.5 8 17 10.5z" />
  </svg>
);

// Speaker — low (speaker.wave.1.fill)
export const SpeakerLowIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M3 9v6h4l5 4V5L7 9H3zm12 .5c1 .8 1.5 1.7 1.5 2.5s-.5 1.7-1.5 2.5l-.8-1c.7-.5 1-1 1-1.5s-.3-1-1-1.5l.8-1z" />
  </svg>
);

// Speaker — high (speaker.wave.2.fill)
export const SpeakerHighIcon: FC<IconProps> = ({ size, ...rest }) => (
  <svg {...wrap(size)} {...rest}>
    <path d="M3 9v6h4l5 4V5L7 9H3zm12 .5c1 .8 1.5 1.7 1.5 2.5s-.5 1.7-1.5 2.5l-.8-1c.7-.5 1-1 1-1.5s-.3-1-1-1.5l.8-1zm2.3-2.3C19 8.5 20 10.1 20 12s-1 3.5-2.7 4.8l-.9-1.1C17.6 14.7 18.5 13.4 18.5 12s-.9-2.7-2.1-3.7l.9-1.1z" />
  </svg>
);
```

- **MIRROR**: Existing component file naming (`PascalCase.tsx`). Project has no other SVG icons today, so this is the new pattern reference.
- **IMPORTS**: only React types.
- **GOTCHA**: All icons must use `fill="currentColor"` (set in `wrap`) so the parent `color` token controls them. Setting `fill` to a hardcoded value would break theming and active-state coloring. The `'aria-hidden': true` ensures screen readers ignore the icon — labels go on the wrapping `<button>`.
- **VALIDATE**: `pnpm typecheck` clean. Render any one icon in the running app temporarily to confirm shape — then revert the temp render.

### Task 2: Update tokens — title bar grows, player bar collapses
- **ACTION**: Edit `src/styles/tokens.css`.
- **IMPLEMENT**:
  - Line 45: `--player-bar-height: 0px;` (was `72px`).
  - Line 46: `--title-bar-height: 56px;` (was `38px`).
  - Add a comment at line 43 explaining: `/* Layout — chrome integrated with title bar; --player-bar-height retained at 0 so existing overlay math (NowPlaying, QueuePanel) collapses correctly without touching those files. */`
- **MIRROR**: existing comment-then-block style of tokens.css.
- **IMPORTS**: none.
- **GOTCHA**: Do NOT remove `--player-bar-height`. NowPlaying.tsx:74 (`bottom: var(--player-bar-height)`), QueuePanel.tsx:612, and arithmetic in QueuePanel.tsx:613 / NowPlaying.tsx:248,326 all read it. Setting to `0px` makes all those `calc(... - 0px)` no-ops.
- **VALIDATE**: After Task 6, NowPlaying opens flush with the bottom of the window, top edge sits beneath the new chrome (no overlap). Same for QueuePanel.

### Task 3: Add Apple-Music slider CSS
- **ACTION**: Append a `data-vibeytm-slider` block to `src/styles/global.css` (after the keyframes).
- **IMPLEMENT**:

```css
/* Apple-Music-style slider used by PlayerChrome (volume + Now-Playing-card progress).
   Track is a thin 2px line; the fill-to-the-left effect comes from a CSS
   gradient set inline on the input's background (where progress percent
   is computed from React state). The thumb is invisible at rest and
   reveals on hover/active so the slider reads as a clean line until the
   user reaches for it — Apple Music's signature treatment. */
input[type="range"][data-vibeytm-slider] {
  -webkit-appearance: none;
  appearance: none;
  height: 2px;
  border-radius: var(--radius-full);
  cursor: pointer;
  outline: none;
  /* `background` is set inline (gradient with progress %) */
}

input[type="range"][data-vibeytm-slider]::-webkit-slider-runnable-track {
  height: 2px;
  background: transparent;
  border-radius: var(--radius-full);
}

input[type="range"][data-vibeytm-slider]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  margin-top: -4px; /* center 10px thumb on 2px track */
  border-radius: var(--radius-full);
  background: var(--color-text-primary);
  border: none;
  opacity: 0;
  transform: scale(0.8);
  transition: opacity var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}

input[type="range"][data-vibeytm-slider]:hover::-webkit-slider-thumb,
input[type="range"][data-vibeytm-slider]:active::-webkit-slider-thumb,
input[type="range"][data-vibeytm-slider]:focus-visible::-webkit-slider-thumb {
  opacity: 1;
  transform: scale(1);
}

input[type="range"][data-vibeytm-slider]:hover {
  height: 3px;
}
```

- **MIRROR**: existing `@keyframes` block style — comments above each rule explain the *why*.
- **IMPORTS**: none.
- **GOTCHA**: Both the input AND the thumb need `appearance: none` for the hover-reveal pattern to work in WKWebView. Without it, the OS slider chrome bleeds through. The track is a thin 2px line (instead of 3px) because the Now-Playing card progress is even more minimal in AM.
- **VALIDATE**: After Task 4 (chrome rendering), hover the volume slider — thumb fades in, track grows from 2px to 3px.

### Task 4: Create the Now-Playing card widget
- **ACTION**: Create `src/components/player/NowPlayingCard.tsx`.
- **IMPLEMENT**: A self-contained component rendering the rounded display widget:

```tsx
// SOURCE: src/components/player/NowPlayingCard.tsx (NEW)
import { type FC } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { useAudioCounterpartArtwork } from '../../hooks/useAudioCounterpartArtwork';
import { albumArtOrNothing } from '../../lib/artwork';
import { ArtworkPlaceholder } from '../ArtworkPlaceholder';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';
import { playerApi } from '../../lib/ipc';

interface Props {
  onOpenNowPlaying: () => void;
  nowPlayingOpen: boolean;
}

const formatTime = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const NowPlayingCard: FC<Props> = ({ onOpenNowPlaying, nowPlayingOpen }) => {
  const { track, status, positionSecs, applyOptimistic, markSeek } = usePlayerState();
  const isPlaying = status === 'playing';
  const counterpartArtwork = useAudioCounterpartArtwork(track?.videoId, track?.artworkUrl);

  const duration = track?.durationSecs ?? 0;
  const safePosition = duration > 0 ? Math.min(positionSecs, duration) : positionSecs;
  const progress = duration > 0 ? Math.min(1, Math.max(0, safePosition / duration)) : 0;
  const remaining = Math.max(0, duration - safePosition);

  const artUrl = albumArtOrNothing(counterpartArtwork ?? track?.artworkUrl ?? null);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 'var(--space-3)',
        width: '100%',
        maxWidth: '640px',
        height: '44px',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)',
        padding: '0 var(--space-3) 0 0',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Cover thumbnail — opens NowPlaying */}
      <button
        type="button"
        onClick={onOpenNowPlaying}
        aria-label={nowPlayingOpen ? 'Close now playing' : 'Open now playing'}
        aria-pressed={nowPlayingOpen}
        style={{
          width: '44px',
          height: '44px',
          flexShrink: 0,
          padding: 0,
          background: 'var(--color-surface-3)',
          overflow: 'hidden',
          borderRadius: 'var(--radius-md) 0 0 var(--radius-md)',
          cursor: 'pointer',
        }}
      >
        {artUrl
          ? <CachedImage src={artUrl} alt="" width={44} height={44}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <ArtworkPlaceholder size={44} />}
      </button>

      {/* Title + artist column */}
      <div style={{
        minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: '2px', paddingTop: '4px',
      }}>
        {track ? (
          <>
            <MarqueeText
              text={track.title}
              style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}
            />
            <div style={{
              fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {track.artist}
              {track.album ? <span style={{ opacity: 0.7 }}> — {track.album}</span> : null}
            </div>
          </>
        ) : (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
            Not playing
          </span>
        )}
      </div>

      {/* Time stack — elapsed top, remaining bottom */}
      <div style={{
        flexShrink: 0, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'flex-end', gap: '2px',
        fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)',
        fontVariantNumeric: 'tabular-nums', minWidth: '40px',
      }}>
        <span>{formatTime(safePosition)}</span>
        <span>−{formatTime(remaining)}</span>
      </div>

      {/* Progress bar — embedded along the bottom edge of the card */}
      {track && duration > 0 && (
        <input
          type="range"
          data-vibeytm-slider
          min={0}
          max={duration}
          value={safePosition}
          onChange={(e) => {
            const raw = Number(e.target.value);
            const next = Math.min(raw, Math.max(0, duration - 1.25));
            markSeek(next);
            if (isPlaying) {
              applyOptimistic({ positionSecs: next, status: 'playing' });
            } else {
              applyOptimistic({ positionSecs: next });
            }
            playerApi.seek(next);
            if (!isPlaying) {
              applyOptimistic({ status: 'playing' });
              playerApi.play().catch(() => { applyOptimistic({ status: 'paused' }); });
            }
          }}
          style={{
            position: 'absolute',
            left: 0, right: 0, bottom: 0,
            width: '100%',
            background: `linear-gradient(to right,
              var(--color-text-secondary) ${progress * 100}%,
              var(--color-surface-3) ${progress * 100}%)`,
          }}
        />
      )}
    </div>
  );
};
```

- **MIRROR**: OPTIMISTIC_UPDATE_PATTERN, MARQUEE WRAPPER, REAL `<button>`, TOKEN-ONLY STYLING.
- **IMPORTS**: as written above.
- **GOTCHA**:
  - The seek `onChange` carries the issue #57 end-of-track clamp (`duration - 1.25`) and the issue #41 buffering-flash workaround (`status: 'playing'` during seek-while-playing). Both are load-bearing — copy verbatim.
  - The progress bar is `position: absolute; bottom: 0` so it sits inside the card on the bottom edge. The card itself is `position: relative` to anchor it. The slider's track CSS hides the track background; the gradient-on-input provides the visible progress fill.
  - `track.album` may be undefined for many YTM responses — render conditionally.
  - Cover button click opens NowPlaying — this is the ONLY entry point now.
- **VALIDATE**: After Task 6, click the cover thumbnail → NowPlaying opens. Drag the inline progress bar → seek fires + thumb appears + (if paused) resume.

### Task 5: Create the PlayerChrome component
- **ACTION**: Create `src/components/layout/PlayerChrome.tsx`.
- **IMPLEMENT**: The full top-chrome component. Structure: outer `<header>` (drag region) → 3 inline children: transport-icons cluster (left), NowPlayingCard (center), utility-icons cluster (right).

Key sections (full file written during implementation; the block here is the structural skeleton + the load-bearing handlers):

```tsx
// SOURCE: src/components/layout/PlayerChrome.tsx (NEW)
import { type FC, type ReactNode, useEffect } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { preloadLyrics } from '../../hooks/useLyrics';
import {
  preloadAudioCounterpartArtwork,
} from '../../hooks/useAudioCounterpartArtwork';
import { isAlbumArtUrl } from '../../lib/artwork';
import { lookupTrackArtwork } from '../../lib/trackArtworkRegistry';
import {
  browseApi, cacheApi, getActivePlaylistId,
  getPlannedNext, getPlannedPrevious, playerApi, setPredictedTrack,
} from '../../lib/ipc';
import type { RepeatMode } from '../../lib/types';
import {
  ShuffleIcon, PrevIcon, PlayIcon, PauseIcon, NextIcon,
  RepeatIcon, RepeatOneIcon, HeartIcon, HeartFillIcon,
  LyricsIcon, QueueIcon, SpeakerMuteIcon, SpeakerLowIcon, SpeakerHighIcon,
} from '../icons';
import { NowPlayingCard } from '../player/NowPlayingCard';

interface PlayerChromeProps {
  onToggleNowPlaying: () => void;
  nowPlayingOpen: boolean;
  onToggleLyrics: () => void;
  lyricsOpen: boolean;
  onToggleQueue: () => void;
  queueOpen: boolean;
}

const TRAFFIC_LIGHT_RESERVE = '80px'; // macOS — leave space for traffic-light buttons (titleBarStyle: Overlay)

const TransportButton: FC<{
  label: string; onClick: () => void;
  children: ReactNode;
  isActive?: boolean;
  size?: number;
}> = ({ label, onClick, children, isActive = false, size = 28 }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: `${size}px`, height: `${size}px`,
      color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
      transition: 'color var(--duration-fast) var(--ease-out)',
    }}
    onMouseEnter={(e) => {
      if (!isActive) e.currentTarget.style.color = 'var(--color-text-primary)';
    }}
    onMouseLeave={(e) => {
      if (!isActive) e.currentTarget.style.color = 'var(--color-text-secondary)';
    }}
  >
    {children}
  </button>
);

const UtilityButton: typeof TransportButton = (props) => (
  <TransportButton {...props} size={props.size ?? 22} />
);

const NEXT_REPEAT_MODE: Record<RepeatMode, RepeatMode> = {
  none: 'all', all: 'one', one: 'none',
};
const REPEAT_ARIA: Record<RepeatMode, string> = {
  none: 'Repeat off', all: 'Repeat all', one: 'Repeat one',
};

export const PlayerChrome: FC<PlayerChromeProps> = ({
  onToggleNowPlaying, nowPlayingOpen,
  onToggleLyrics, lyricsOpen,
  onToggleQueue, queueOpen,
}) => {
  const state = usePlayerState();
  const { track, status, volume, isShuffled, repeatMode, isLiked, applyOptimistic } = state;
  const isPlaying = status === 'playing';

  // ===== PRELOAD EFFECT — copy VERBATIM from PlayerBar.tsx:168-263 =====
  const currentVideoId = track?.videoId;
  useEffect(() => {
    if (!currentVideoId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const warmCoverFor = (next: { videoId: string; artworkUrl?: string | null }): void => {
        let coverUrl = lookupTrackArtwork(next.videoId);
        if (!coverUrl && isAlbumArtUrl(next.artworkUrl)) coverUrl = next.artworkUrl as string;
        if (coverUrl) { void cacheApi.fetchImage(coverUrl).catch(() => {}); return; }
        preloadAudioCounterpartArtwork(next.videoId);
      };
      const planned = getPlannedNext();
      if (planned?.videoId) {
        preloadLyrics({
          videoId: planned.videoId, artist: planned.artist,
          title: planned.title, durationSecs: planned.durationSecs,
        });
        warmCoverFor({ videoId: planned.videoId, artworkUrl: planned.artworkUrl });
        return;
      }
      browseApi.getUpcomingTracks(currentVideoId, 2).then((tracks) => {
        if (cancelled) return;
        const next = tracks.find((t) => t.videoId && t.videoId !== currentVideoId);
        if (next) {
          preloadLyrics({
            videoId: next.videoId, artist: next.artist,
            title: next.title, durationSecs: next.durationSecs,
          });
          warmCoverFor({ videoId: next.videoId, artworkUrl: next.artworkUrl });
        }
      }).catch(() => {});
    }, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentVideoId]);
  // =====================================================================

  const handleTogglePlay = () => {
    applyOptimistic({ status: isPlaying ? 'paused' : 'playing' });
    playerApi.togglePlay().catch(() => {
      applyOptimistic({ status: isPlaying ? 'playing' : 'paused' });
    });
  };
  const handleToggleShuffle = () => {
    applyOptimistic({ isShuffled: !isShuffled });
    playerApi.toggleShuffle().catch(() => { applyOptimistic({ isShuffled }); });
  };
  const handleCycleRepeat = () => {
    applyOptimistic({ repeatMode: NEXT_REPEAT_MODE[repeatMode] });
    playerApi.cycleRepeat().catch(() => { applyOptimistic({ repeatMode }); });
  };
  const handleToggleLike = () => {
    applyOptimistic({ isLiked: !isLiked });
    playerApi.toggleLike().catch(() => { applyOptimistic({ isLiked }); });
  };
  const handlePrev = () => {
    const prev = getPlannedPrevious();
    if (prev?.videoId) {
      setPredictedTrack(prev);
      applyOptimistic({ track: prev, positionSecs: 0 });
      const pl = getActivePlaylistId() ?? undefined;
      playerApi.playTrack(prev.videoId, pl).catch(() => {});
    } else {
      playerApi.previous();
    }
  };
  const handleNext = () => {
    const next = getPlannedNext();
    if (next?.videoId) {
      setPredictedTrack(next);
      applyOptimistic({ track: next, positionSecs: 0 });
      const pl = getActivePlaylistId() ?? undefined;
      playerApi.playTrack(next.videoId, pl).catch(() => {});
    } else {
      playerApi.next();
    }
  };

  const SpeakerGlyph =
    volume === 0 ? SpeakerMuteIcon : volume < 0.5 ? SpeakerLowIcon : SpeakerHighIcon;

  return (
    <header
      data-tauri-drag-region
      style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 'var(--title-bar-height)',
        background: 'var(--color-surface-1)',
        borderBottom: '1px solid oklch(100% 0 0 / 0.06)',
        display: 'flex', alignItems: 'center',
        padding: `0 var(--space-3) 0 ${TRAFFIC_LIGHT_RESERVE}`,
        gap: 'var(--space-3)',
        zIndex: 200,
      }}
    >
      {/* LEFT — transports */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
        <TransportButton label="Shuffle" onClick={handleToggleShuffle} isActive={isShuffled}>
          <ShuffleIcon size={18} />
        </TransportButton>
        <TransportButton label="Previous" onClick={handlePrev}>
          <PrevIcon size={22} />
        </TransportButton>
        <TransportButton label={isPlaying ? 'Pause' : 'Play'} onClick={handleTogglePlay} size={32}>
          {isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </TransportButton>
        <TransportButton label="Next" onClick={handleNext}>
          <NextIcon size={22} />
        </TransportButton>
        <TransportButton
          label={REPEAT_ARIA[repeatMode]}
          onClick={handleCycleRepeat}
          isActive={repeatMode !== 'none'}
        >
          {repeatMode === 'one' ? <RepeatOneIcon size={18} /> : <RepeatIcon size={18} />}
        </TransportButton>
      </div>

      {/* CENTER — Now Playing card (the AM signature) */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        <NowPlayingCard onOpenNowPlaying={onToggleNowPlaying} nowPlayingOpen={nowPlayingOpen} />
      </div>

      {/* RIGHT — utilities */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        {/* Volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <span style={{
            display: 'inline-flex', width: '20px', justifyContent: 'center',
            color: 'var(--color-text-tertiary)',
          }}>
            <SpeakerGlyph size={18} />
          </span>
          <input
            type="range"
            data-vibeytm-slider
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              const next = Number(e.target.value) / 100;
              applyOptimistic({ volume: next });
              playerApi.setVolume(next);
            }}
            style={{
              width: '88px',
              background: `linear-gradient(to right,
                var(--color-text-secondary) ${volume * 100}%,
                var(--color-surface-3) ${volume * 100}%)`,
            }}
          />
        </div>

        <UtilityButton
          label={isLiked ? 'Unlike' : 'Like'}
          onClick={handleToggleLike}
          isActive={isLiked}
        >
          {isLiked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}
        </UtilityButton>

        {track && (
          <UtilityButton
            label={lyricsOpen ? 'Hide lyrics' : 'Show lyrics'}
            onClick={onToggleLyrics}
            isActive={lyricsOpen}
          >
            <LyricsIcon size={18} />
          </UtilityButton>
        )}

        <UtilityButton
          label={queueOpen ? 'Hide queue' : 'Show queue'}
          onClick={onToggleQueue}
          isActive={queueOpen}
        >
          <QueueIcon size={18} />
        </UtilityButton>
      </div>
    </header>
  );
};
```

- **MIRROR**: All five patterns above.
- **IMPORTS**: as listed.
- **GOTCHA**:
  - `data-tauri-drag-region` on the outer `<header>` — clicks on `<button>` children pass through normally; clicks on the empty space drag the window. Verified Tauri behavior.
  - `padding-left: 80px` reserves space for macOS traffic-light buttons; do NOT use a token here (no semantic token for "macOS chrome reserve").
  - `zIndex: 200` matches today's title-bar zIndex (AppShell.tsx:51) so the chrome stays above NowPlaying / QueuePanel overlays.
  - The preload effect must be copied verbatim — the 2-second deferral is the bridge-saturation fix from CLAUDE.md.
  - On hover, color flips between `--color-text-secondary` (rest) and `--color-text-primary` (hover). NO scale transform.
  - The Now-Playing card center wrapper has `flex: 1` and `justifyContent: center` — narrows naturally on small windows; the card's `maxWidth: 640px` keeps it from sprawling on wide windows.
  - Speaker glyph slot is fixed-width `20px` so swapping mute/low/high doesn't reflow the slider.
- **VALIDATE**: All transport handlers fire optimistically, all icons tint with `currentColor`, drag the title bar empty space → window moves, drag a button → button click fires (not drag).

### Task 6: Wire PlayerChrome into AppShell
- **ACTION**: Edit `src/components/layout/AppShell.tsx`.
- **IMPLEMENT**:
  - Remove the old title-bar drag div (lines 41-54).
  - Remove the bottom `<PlayerBar />` mount (lines 68-75).
  - Add a `<PlayerChrome />` mount at the top with the same props PlayerBar received.
  - Update `<main>` styles: `paddingTop: 'var(--title-bar-height)'` (already does this — token value just changed); remove the `paddingBottom: 'var(--player-bar-height)'` line OR leave it (it'll evaluate to `0px` and have no visual effect — SAFER to leave to keep the diff minimal and ensure the `--player-bar-height` token retention has a justified consumer).
  - Replace `import { PlayerBar }` with `import { PlayerChrome }`.

```tsx
// SOURCE: src/components/layout/AppShell.tsx (UPDATED — relevant diff)
import { PlayerChrome } from './PlayerChrome';                             // was: import { PlayerBar } from './PlayerBar';
// ...
<main style={{
  overflow: 'auto',
  paddingTop: 'var(--title-bar-height)',
  paddingBottom: 'var(--player-bar-height)',                                // evaluates to 0px now; keep so the consumer is documented
}}>
  {children}
</main>
<PlayerChrome
  onToggleNowPlaying={onToggleNowPlaying}
  nowPlayingOpen={nowPlayingOpen}
  lyricsOpen={lyricsOpen}
  onToggleLyrics={onToggleLyrics}
  queueOpen={queueOpen}
  onToggleQueue={onToggleQueue}
/>
// (delete the old `<div data-tauri-drag-region ... />` block at top)
// (delete the old `<PlayerBar ... />` mount at bottom)
```

- **MIRROR**: Existing AppShell structure and prop forwarding.
- **IMPORTS**: replace `PlayerBar` with `PlayerChrome`.
- **GOTCHA**: NowPlaying and QueuePanel remain mounted as-is. Their fixed-position overlays use `top: var(--title-bar-height)` (now 56) and `bottom: var(--player-bar-height)` (now 0) — automatically correct.
- **VALIDATE**: `pnpm typecheck` clean. App launches with chrome at top, no bottom bar, content reaches the bottom of the window.

### Task 7: Delete the old PlayerBar
- **ACTION**: Delete `src/components/layout/PlayerBar.tsx`.
- **IMPLEMENT**: `rm src/components/layout/PlayerBar.tsx`.
- **MIRROR**: N/A.
- **IMPORTS**: confirm no remaining `import.*PlayerBar` anywhere: `grep -rn "PlayerBar" src/` should only match `PlayerChrome` references (or zero matches).
- **GOTCHA**: AppShell is the only known importer (verified earlier). Run the grep to be sure before deleting.
- **VALIDATE**: `pnpm typecheck` clean after delete; `pnpm test` clean (no test imports PlayerBar today).

### Task 8: Token-only and lint sweep
- **ACTION**: After all the above, search the new files for hardcoded colors and dimensions.
- **IMPLEMENT**: `grep -nE '#[0-9a-fA-F]{3,6}|rgb\(|rgba\(' src/components/layout/PlayerChrome.tsx src/components/player/NowPlayingCard.tsx src/components/icons/index.tsx` — should be ZERO matches except for SVG paths (`d="M..."` numerics are fine; those aren't colors).
- **MIRROR**: TOKEN-ONLY STYLING.
- **IMPORTS**: none.
- **GOTCHA**: The traffic-light reserve `80px` is the one allowed literal in PlayerChrome (no token; documented inline). Everything else uses tokens.
- **VALIDATE**: grep returns no color literals.

### Task 9: Live verification (Tauri dev)
- **ACTION**: Restart and exercise the running app per the project's verification discipline (CLAUDE.md).
- **IMPLEMENT**: `pkill -f "tauri dev" 2>/dev/null; pkill -f "VibeYTM" 2>/dev/null; sleep 1; cd /Users/dongli/workspace/superset-wt/VibeYTM/1.0.0 && pnpm tauri dev` (background).
- **MIRROR**: project restart pattern.
- **VALIDATE** (manual checklist on running app):
  - Chrome is at the top, 56px tall, sits flush with traffic-light buttons (no overlap)
  - Empty space in chrome drags the window (drag a non-button area near the right edge)
  - Click any transport button → fires (not drag)
  - Play/Pause swap glyph in place; play has heavier visual weight without a fill
  - Cover thumbnail in card → opens NowPlaying panel from the right
  - Drag the inline progress bar → seek + thumb appears
  - Volume drag → glyph cycles 🔇/🔈/🔊 with no jitter; no audio burst on track change (volume-lock still working)
  - Click LRC icon → lyrics overlay opens
  - Click queue icon (☰) → QueuePanel opens
  - Bottom of window has no chrome — main content reaches the bottom
  - NowPlaying overlay still positions correctly (top of overlay sits beneath the new chrome; bottom flush with window)
  - QueuePanel still positions correctly (same)
  - Playing-bars animation in QueuePanel re-mounts on prev/next (planned-track preserved)
  - Take a screenshot via the project's `screencapture -l <windowID>` workflow; blur the profile area in sidebar bottom-left before sharing

---

## Testing Strategy

### Unit Tests
The project has zero existing tests for PlayerBar, and the new chrome is almost entirely styled JSX with side-effectful IPC calls. **No unit tests added in this scope** — behavioral coverage is best handled at integration level. The contract test in `src/components/LoadingOverlay.test.tsx` is unaffected by this change.

### Edge Cases Checklist
- [ ] No track playing — center card shows "Not playing" centered; transport buttons render and no-op safely
- [ ] Long title (50+ char Chinese title) — MarqueeText still triggers in the card's narrowed title slot
- [ ] Window narrowed to 900px — three regions don't overlap; card narrows to its `minWidth: 0` while still showing cover + truncated title
- [ ] Volume = 0 — speaker glyph swaps to mute (🔇), no width jitter
- [ ] Volume drag from 0 → 100 — glyph cycles 🔇 → 🔈 → 🔊 cleanly
- [ ] Repeat-one — "1" renders inside the loop SVG (not as a corner badge)
- [ ] Like (♡) toggle — heart fills/empties via separate HeartIcon/HeartFillIcon swap
- [ ] Seek-while-paused → resumes (issue #41 workaround preserved in NowPlayingCard)
- [ ] Seek to end of short track → clamped to `duration - 1.25s` (issue #57 workaround preserved)
- [ ] Click prev/next → QueuePanel's playing-bars re-mounts on the new track immediately
- [ ] Cover-thumb click → NowPlaying opens (only entry point now)
- [ ] Title bar drag region empty space → window moves
- [ ] Title bar drag region over a button → button click fires (no drag)

---

## Validation Commands

### Static Analysis
```bash
cd /Users/dongli/workspace/superset-wt/VibeYTM/1.0.0 && pnpm typecheck
```
EXPECT: Zero type errors.

### Unit Tests (existing — must stay green)
```bash
cd /Users/dongli/workspace/superset-wt/VibeYTM/1.0.0 && pnpm test
```
EXPECT: All existing tests pass.

### Rust Build (no Rust changes; verify nothing leaked)
```bash
cd /Users/dongli/workspace/superset-wt/VibeYTM/1.0.0/src-tauri && cargo check
cd /Users/dongli/workspace/superset-wt/VibeYTM/1.0.0/src-tauri && cargo test --lib
```
EXPECT: `cargo check` clean (existing warnings only); `cargo test --lib` 93 passed.

### Live Browser Validation (Tauri dev)
```bash
pkill -f "tauri dev" 2>/dev/null; pkill -f "VibeYTM" 2>/dev/null; sleep 1
cd /Users/dongli/workspace/superset-wt/VibeYTM/1.0.0 && pnpm tauri dev
```
EXPECT: app launches, chrome at top, no bottom bar, all interactions per the manual checklist work.

### Manual Validation
- [ ] All items in Task 9 checklist pass

---

## Acceptance Criteria
- [ ] All 9 tasks completed
- [ ] All validation commands pass (typecheck, vitest, cargo check, cargo test --lib)
- [ ] No type errors, no new lint warnings
- [ ] PlayerChrome is at the top, 56px tall, integrated with the title bar
- [ ] Bottom of window has no player chrome; main content reaches the bottom
- [ ] All transport icons are flat SVG (currentColor), no filled circles, no scale-on-hover
- [ ] Play button is the same flat-SVG style as siblings, just heavier glyph (28px vs 22px)
- [ ] Now-Playing card is one rounded `--color-surface-2` widget bundling cover + title + artist + times + 2px progress bar
- [ ] Right cluster has speaker+volume, ♡ like, lyrics, queue (no 𝄢 duplicate)
- [ ] Volume speaker cycles 🔇/🔈/🔊 with no jitter
- [ ] All optimistic-update + planned-track + preload + seek-resume + volume-lock behavior preserved
- [ ] Tauri window-drag still works on empty chrome space; buttons unaffected
- [ ] macOS traffic-light buttons don't overlap chrome content
- [ ] No `#` / `rgb(` / `rgba(` literals in new files (token-only styling)

## Completion Checklist
- [ ] Code follows discovered patterns (component naming, optimistic-update, marquee wrapper, planned-next/prev, preload deferral)
- [ ] Error handling matches codebase style (`.catch` reverts via `applyOptimistic`)
- [ ] Logging follows codebase conventions (no new logs needed — UI-only change)
- [ ] Tests follow test patterns (none added; existing tests untouched and green)
- [ ] No hardcoded values (token sweep done in Task 8)
- [ ] CLAUDE.md updated with anything load-bearing? Likely YES — add a note under "WKWebView quirks" that "Tauri `data-tauri-drag-region` lets clicks pass through to `<button>` children but NOT through naked SVGs; always wrap interactive icons in `<button>`."
- [ ] No unnecessary scope additions
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tauri drag-region eats clicks on inline SVGs | Low | Buttons appear non-clickable (worst regression in CLAUDE.md history) | Every icon is wrapped in `<button>` per the existing rule; tested in Task 9 |
| macOS traffic-lights overlap shuffle button | Medium | First button unclickable / partially obscured | 80px reserve on the left of the chrome (documented inline) |
| Hover-reveal slider thumb invisible in WKWebView | Low | Slider thumb stays hidden permanently (cosmetic) | `appearance: none` on both input AND thumb (Task 3); tested in Task 9 |
| NowPlaying overlay open animation now slides from a different edge | Low | Animation feels off | The overlay is `top: var(--title-bar-height)` already; only the *value* changes from 38 to 56. The `translateY(24px)` enter animation reads naturally with either |
| Card progress bar gets clipped at end position | Low | Cosmetic — thumb half-clips at pos=duration | Browser default; not worth fixing |
| `--player-bar-height: 0px` accidentally hides content | Low | None — the token only contributes to padding/margin math, all of which collapses cleanly to 0 | Verified by reading every consumer (NowPlaying.tsx:74, 248, 326; QueuePanel.tsx:612, 613; AppShell.tsx:62) |
| Bridge `--player-bar-height` removal would break NowPlaying / QueuePanel | N/A | Catastrophic | Plan keeps the token defined at `0px` rather than removing it — math collapses cleanly without touching either file |
| Transport-row + card + utility-row overflows at narrow widths | Medium | Card pushes utilities off-screen at 900px | Card has `maxWidth: 640px`; if narrower, the `flex: 1` center wrapper compresses the card down to its `minWidth: 0` boundary while the side clusters keep their natural width. Verified in Task 9 manual check at 900px |
| Speaker emoji renders inconsistently — solved by using SVG icons | N/A | None | Plan uses SVG (`SpeakerHighIcon`, `SpeakerLowIcon`, `SpeakerMuteIcon`) not emoji — consistent across OS versions |

## Notes
- The CLAUDE.md "Conflict Detection" rule was applied: this redesign reverses no documented invariant. The "real `<button>`" rule is reinforced everywhere. The `pointer-events` rule is unaffected. The `transform: scale(...)` hit-testing rule (LoadingOverlay quirk) is unaffected — no transforms on overlays.
- The duplicate Now-Playing toggle (𝄢) is removed; cover thumbnail in the card is now the single entry point — matches Apple Music.
- The `vibeytm-queue-current-flash` keyframe and the `setPredictedTrack` mechanism that drives QueuePanel's instant-row animation are explicitly kept untouched — this plan only touches the player chrome's render output.
- Future follow-up (NOT in this scope):
  - Hover-reveal seek tooltip showing the seek time as the cursor moves over the embedded progress bar
  - Click on speaker glyph to mute/unmute (non-AM but commonly requested)
  - "Now playing" expand-to-full-screen view (Apple Music's full-screen player)
  - AirPlay-style output device picker (project doesn't currently support multiple output devices)
