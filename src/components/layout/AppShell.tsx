import { type FC, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { PlayerChrome } from './PlayerChrome';
import { NowPlaying } from '../player/NowPlaying';
import { QueuePanel } from '../player/QueuePanel';
import { LyricsOverlay } from '../player/LyricsOverlay';
import { FocusTimer } from '../player/FocusTimer';

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
  onFocusTimerStateChange: (state: 'idle' | 'running' | 'done') => void;
  onFocusTimerClose: () => void;
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
  children,
}) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'var(--sidebar-width) 1fr',
      gridTemplateRows: '1fr',
      height: '100%',
      overflow: 'hidden',
    }}
  >
    {/* Title bar drag region (full width — collapse toggle removed). */}
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

    <Sidebar currentPath={currentPath} onNavigate={onNavigate} />

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
