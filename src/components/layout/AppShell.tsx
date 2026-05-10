import { type FC, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { PlayerChrome } from './PlayerChrome';
import { NowPlaying } from '../player/NowPlaying';
import { QueuePanel } from '../player/QueuePanel';
import { LyricsOverlay } from '../player/LyricsOverlay';
import { FocusTimer } from '../player/FocusTimer';
import type { FocusTimerState } from '../player/FocusTimer/useFocusTimerCountdown';
import { SidebarHideIcon, SidebarShowIcon } from '../icons';

interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  nowPlayingOpen: boolean;
  onToggleNowPlaying: () => void;
  lyricsOpen: boolean;
  onToggleLyrics: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
  focusTimerOpen: boolean;
  onToggleFocusTimer: () => void;
  onFocusTimerStateChange: (state: FocusTimerState) => void;
  onFocusTimerClose: () => void;
  /** Whether the sidebar is currently visible. Persisted by App.tsx
   *  to localStorage so the choice survives launches. */
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  children: ReactNode;
}

export const AppShell: FC<AppShellProps> = ({
  currentPath,
  onNavigate,
  nowPlayingOpen,
  onToggleNowPlaying,
  lyricsOpen,
  onToggleLyrics,
  queueOpen,
  onToggleQueue,
  focusTimerOpen,
  onToggleFocusTimer,
  onFocusTimerStateChange,
  onFocusTimerClose,
  sidebarVisible,
  onToggleSidebar,
  children,
}) => (
  <div
    style={{
      display: 'grid',
      // `--sidebar-effective-width` is the SINGLE source of truth for any
      // surface that needs to know how much horizontal space the sidebar
      // is currently taking. PlayerChrome, NowPlaying, LyricsOverlay,
      // QueuePanel, FocusTimer, DetailPageHero, and SafeOverlay all read
      // this variable so they slide left in lockstep when the sidebar
      // collapses (and back when it reopens). Plain `var(--sidebar-width)`
      // is the fixed 240px constant — only the sidebar's own internal
      // width should use that.
      ['--sidebar-effective-width' as string]: sidebarVisible
        ? 'var(--sidebar-width)'
        : '0px',
      // Animate the sidebar column between full width and zero. WebKit
      // (and modern Chromium) supports transitioning grid-template-columns
      // when both endpoints are concrete length values, so the slide reads
      // smoothly without us having to maintain a parallel margin/transform
      // on the main content. The Sidebar's own translateX transition
      // (below) finishes the visual handoff.
      gridTemplateColumns: 'var(--sidebar-effective-width) 1fr',
      gridTemplateRows: '1fr',
      height: '100%',
      overflow: 'hidden',
      transition: 'grid-template-columns var(--duration-slow) var(--ease-out)',
    }}
  >
    {/* Title bar drag region (full width). */}
    <div
      data-tauri-drag-region
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--title-bar-height)',
        zIndex: 200,
        // @ts-expect-error -- non-standard WebKit property for Tauri window dragging
        WebkitAppRegion: 'drag',
      }}
    />

    {/* Sidebar toggle. Sits in the title bar drag region just to the right
     *  of the macOS traffic-light controls. `WebkitAppRegion: no-drag` so
     *  clicks aren't swallowed by the drag region underneath. The icon
     *  flips orientation by state so the affordance reads at a glance —
     *  PanelLeftClose says "hide" while open, PanelLeftOpen says "show"
     *  while collapsed. Apple Music uses ⌘\ as the keyboard equivalent;
     *  matched in App.tsx. */}
    <button
      type="button"
      onClick={onToggleSidebar}
      aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
      title={sidebarVisible ? 'Hide sidebar (⌘\\)' : 'Show sidebar (⌘\\)'}
      style={{
        position: 'fixed',
        top: 8,
        // 84px clears the macOS traffic-light cluster (close/min/max)
        // which sits at roughly x=10..76 in the overlay title bar.
        left: 84,
        width: 28,
        height: 22,
        zIndex: 250,
        // @ts-expect-error -- WebKit property; lets the click reach the button
        WebkitAppRegion: 'no-drag',
        background: 'transparent',
        border: 'none',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition:
          'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'oklch(100% 0 0 / 0.06)';
        e.currentTarget.style.color = 'var(--color-text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--color-text-secondary)';
      }}
    >
      {sidebarVisible ? (
        <SidebarHideIcon size={16} />
      ) : (
        <SidebarShowIcon size={16} />
      )}
    </button>

    {/* Sidebar wrapper — owns the translateX so the slide animates as
     *  a unit. Translation is in pixel units (calc(-1 * --sidebar-width))
     *  not -100%; the wrapper's width is shrinking alongside the grid
     *  column, and -100% of a shrinking width collapses the slide back
     *  to zero displacement at column-width=0. Pixel units keep the
     *  slide a constant 240px regardless of the wrapper's current size.
     *
     *  `inert` removes the offscreen sidebar from the tab order, focus
     *  ring, and pointer events while collapsed; restored as soon as
     *  the slide-in starts so the contents are interactive throughout
     *  the animation. */}
    <div
      // @ts-expect-error -- React 19 supports `inert`; the type is widely
      // shipped but DefinitelyTyped's prop list lags
      inert={!sidebarVisible ? '' : undefined}
      style={{
        overflow: 'hidden',
        transform: sidebarVisible
          ? 'translateX(0)'
          : 'translateX(calc(-1 * var(--sidebar-width)))',
        transition: 'transform var(--duration-slow) var(--ease-out)',
      }}
    >
      <Sidebar currentPath={currentPath} onNavigate={onNavigate} />
    </div>

    <main
      style={{
        overflow: 'auto',
        // No paddingTop — the 12 px seam is now INSIDE each section
        // (a spacer at the start of section's scroll content). The
        // title plate sticks just below the spacer (sticky `top:
        // var(--space-3)`), so as content scrolls, scrolled rows
        // visibly pass through the seam window before being clipped
        // at section's top edge.
      }}
    >
      {/*
        No paddingBottom on `<main>` and no extra wrapper div around
        children — both broke things:
          • paddingBottom on an `overflow:auto` container is excluded
            from `scrollHeight` in WebKit / WKWebView, so content
            scrolls UNDER the floating player chrome.
          • a wrapper div with paddingBottom collapsed each page's
            `<section style={{ height: '100% }}>` to 0 (its parent's
            height became `auto`), which destroyed the sticky context
            for each page's title plate (the plate scrolled away with
            main instead of pinning).
        Each page reserves the bottom space itself via a spacer div at
        the end of its `<section>` (see HomePage / SearchPage / etc.).
      */}
      {children}
    </main>

    <PlayerChrome
      onToggleNowPlaying={onToggleNowPlaying}
      nowPlayingOpen={nowPlayingOpen}
      lyricsOpen={lyricsOpen}
      onToggleLyrics={onToggleLyrics}
      queueOpen={queueOpen}
      onToggleQueue={onToggleQueue}
      focusTimerOpen={focusTimerOpen}
      onToggleFocusTimer={onToggleFocusTimer}
    />

    <NowPlaying
      isOpen={nowPlayingOpen}
      onClose={onToggleNowPlaying}
      showLyrics={lyricsOpen}
      queueOpen={queueOpen}
    />

    <LyricsOverlay isOpen={lyricsOpen} />

    <QueuePanel isOpen={queueOpen} onClose={onToggleQueue} />

    <FocusTimer
      isOpen={focusTimerOpen}
      onClose={onFocusTimerClose}
      onStateChange={onFocusTimerStateChange}
    />
  </div>
);
