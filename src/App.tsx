import { type FC, useState, useCallback, useRef } from 'react';
import './styles/global.css';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './components/pages/HomePage';
import { SearchPage } from './components/pages/SearchPage';
import { LibraryPage } from './components/pages/LibraryPage';
import { ExplorePage } from './components/pages/ExplorePage';
import { SettingsPage } from './components/pages/SettingsPage';
import { LoginPage } from './components/pages/LoginPage';
import { PlaylistDetailPage } from './components/pages/PlaylistDetailPage';

interface ViewingPlaylist {
  id: string;
  autoPlay: boolean;
}

const App: FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentPath, setCurrentPath] = useState('home');
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [viewingPlaylist, setViewingPlaylist] = useState<ViewingPlaylist | null>(null);

  // Lock out rapid second toggles within the animation window so a stray
  // double-click never makes the overlay flash open-and-close.
  const lastToggleAtRef = useRef(0);
  const toggleNowPlaying = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleAtRef.current < 450) return;
    lastToggleAtRef.current = now;
    setIsNowPlayingOpen((prev) => !prev);
  }, []);

  const openPlaylistDetail = useCallback((playlistId: string) => {
    setViewingPlaylist({ id: playlistId, autoPlay: false });
  }, []);

  const openPlaylistAutoPlay = useCallback((playlistId: string) => {
    setViewingPlaylist({ id: playlistId, autoPlay: true });
  }, []);

  if (!isLoggedIn) {
    return <LoginPage onLoggedIn={() => setIsLoggedIn(true)} />;
  }

  const renderPage = () => {
    if (currentPath === 'search') {
      return (
        <SearchPage
          onOpenPlaylist={openPlaylistDetail}
          onAutoPlayPlaylist={openPlaylistAutoPlay}
        />
      );
    }
    if (currentPath === 'explore') {
      return (
        <ExplorePage
          onOpenPlaylist={openPlaylistDetail}
          onAutoPlayPlaylist={openPlaylistAutoPlay}
        />
      );
    }
    if (currentPath === 'settings') return <SettingsPage />;
    if (currentPath.startsWith('library')) {
      // library, library/playlists, library/songs, library/albums, library/artists
      const sub = currentPath.split('/')[1] as
        | 'playlists'
        | 'songs'
        | 'albums'
        | 'artists'
        | undefined;
      return (
        <LibraryPage
          activeTab={sub ?? 'playlists'}
          onOpenPlaylist={openPlaylistDetail}
          onAutoPlayPlaylist={openPlaylistAutoPlay}
        />
      );
    }
    return (
      <HomePage
        onOpenPlaylist={openPlaylistDetail}
        onAutoPlayPlaylist={openPlaylistAutoPlay}
      />
    );
  };

  return (
    <AppShell
      currentPath={currentPath}
      onNavigate={(path) => {
        setViewingPlaylist(null);
        setIsNowPlayingOpen(false);
        setCurrentPath(path);
      }}
      nowPlayingOpen={isNowPlayingOpen}
      onToggleNowPlaying={toggleNowPlaying}
    >
      {/*
        The underlying page (home/search/explore/library/settings) stays
        mounted while a playlist detail is open, so its state — search
        query, scroll position, caches — survives the round trip.
      */}
      <div style={{ position: 'relative', height: '100%' }}>
        {renderPage()}
        {viewingPlaylist && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--color-bg)',
              zIndex: 20,
            }}
          >
            <PlaylistDetailPage
              playlistId={viewingPlaylist.id}
              autoPlay={viewingPlaylist.autoPlay}
              onBack={() => setViewingPlaylist(null)}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default App;
