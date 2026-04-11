import { type FC, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { PlayerBar } from './PlayerBar';
import { NowPlaying } from '../player/NowPlaying';

interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  nowPlayingOpen: boolean;
  onToggleNowPlaying: () => void;
  children: ReactNode;
}

export const AppShell: FC<AppShellProps> = ({
  currentPath,
  onNavigate,
  nowPlayingOpen,
  onToggleNowPlaying,
  children,
}) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'var(--sidebar-width) 1fr',
      gridTemplateRows: '1fr var(--player-bar-height)',
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
        marginRight: nowPlayingOpen ? 'var(--now-playing-width)' : '0',
        transition: `margin-right var(--duration-slow) var(--ease-out)`,
      }}
    >
      {children}
    </main>

    <PlayerBar
      onToggleNowPlaying={onToggleNowPlaying}
      nowPlayingOpen={nowPlayingOpen}
    />

    <NowPlaying isOpen={nowPlayingOpen} onClose={onToggleNowPlaying} />
  </div>
);
