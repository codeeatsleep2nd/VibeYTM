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
      display: 'grid',
      gridTemplateColumns: 'var(--sidebar-width) 1fr',
      gridTemplateRows: '1fr',
      height: '100%',
      overflow: 'hidden',
    }}
  >
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
    />

    <QueuePanel isOpen={queueOpen} onClose={onToggleQueue} />
  </div>
);
