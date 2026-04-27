import { type FC, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { PlayerChrome } from './PlayerChrome';
import { NowPlaying } from '../player/NowPlaying';
import { QueuePanel } from '../player/QueuePanel';

interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  nowPlayingOpen: boolean;
  onToggleNowPlaying: () => void;
  lyricsOpen: boolean;
  onToggleLyrics: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
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
  children,
}) => (
  <div
    style={{
      position: 'relative',
      display: 'grid',
      gridTemplateColumns: 'var(--sidebar-width) 1fr',
      gridTemplateRows: '1fr',
      height: '100%',
      overflow: 'hidden',
    }}
  >
    {/*
      Ambient colour wash — sits BEHIND every other layer (z-index: -1)
      and starts at y = --title-bar-height so the top drag-region strip
      stays truly transparent (Tauri window is transparent there). The
      Liquid Glass surfaces (sidebar / chrome / queue / title plates)
      refract this wash via liquidGL.
    */}
    <div className="app-ambient" aria-hidden="true" />

    {/* Title bar drag region */}
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
        // Reserve space for the title-bar drag region — page content
        // renders below it so the sticky title plate floats as a
        // rounded capsule with the body's ambient gradient visible
        // above its top edge (instead of the plate's top edge being
        // hidden under the drag region).
        paddingTop: 'var(--title-bar-height)',
        paddingBottom: 'var(--player-bar-height)',
      }}
    >
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

    <NowPlaying
      isOpen={nowPlayingOpen}
      onClose={onToggleNowPlaying}
      showLyrics={lyricsOpen}
      queueOpen={queueOpen}
    />

    <QueuePanel isOpen={queueOpen} onClose={onToggleQueue} />
  </div>
);
