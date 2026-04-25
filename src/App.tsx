import { type FC, useState, useCallback, useEffect, useRef } from 'react';
import './styles/global.css';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './components/pages/HomePage';
import { SearchPage } from './components/pages/SearchPage';
import { LibraryPage } from './components/pages/LibraryPage';
import { ExplorePage } from './components/pages/ExplorePage';
import { SettingsPage } from './components/pages/SettingsPage';
import { LoginPage } from './components/pages/LoginPage';
import { PlaylistDetailPage } from './components/pages/PlaylistDetailPage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { useLoginState } from './hooks/useLoginState';
import { ytmApi } from './lib/ipc';

interface ViewingPlaylist {
  id: string;
  autoPlay: boolean;
}

const App: FC = () => {
  const loginState = useLoginState();
  // Local override so the user can dismiss the login page manually (e.g. via
  // "Skip for now") even if the bridge hasn't confirmed sign-in yet.
  const [loginOverride, setLoginOverride] = useState(false);
  const isLoggedIn = loginState === true || loginOverride;
  const [currentPath, setCurrentPath] = useState('home');
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [viewingPlaylist, setViewingPlaylist] = useState<ViewingPlaylist | null>(null);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);
  // Flips true once the Home page has finished its first real render (or we
  // settle into the LoginPage for signed-out users). While false, the
  // WelcomeScreen stays overlaid so cold launch never shows the "Loading…"
  // placeholder or a half-painted Home (issue #56).
  const [isHomeReady, setIsHomeReady] = useState(false);
  const handleHomeReady = useCallback(() => setIsHomeReady(true), []);
  // Bumped whenever the user saves or removes a playlist/album so the
  // LibraryPage knows to refetch even when it stays mounted under the
  // playlist-detail overlay.
  const [libraryVersion, setLibraryVersion] = useState(0);
  const handleLibraryChanged = useCallback(
    () => setLibraryVersion((v) => v + 1),
    [],
  );
  // Remembered so "Settings → Settings" toggles back to where the user was.
  const previousPathRef = useRef<string>('home');

  // Lock out rapid second toggles within the animation window so a stray
  // double-click never makes the overlay flash open-and-close.
  const lastToggleAtRef = useRef(0);
  const toggleNowPlaying = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleAtRef.current < 450) return;
    lastToggleAtRef.current = now;
    setIsNowPlayingOpen((prev) => {
      const next = !prev;
      // When closing, also clear the LRC selected status so the bottom
      // bar's lyrics button no longer renders as active. Without this,
      // the LRC button stays highlighted after the user has dismissed
      // the playing page, making its state look out of sync with what's
      // actually on screen.
      if (!next) setIsLyricsOpen(false);
      return next;
    });
  }, []);

  // Lyrics button opens the Now Playing page if it isn't already, then flips
  // the lyrics view on/off within it.
  const toggleLyrics = useCallback(() => {
    // Clicking LRC always dismisses the queue drawer, whether lyrics is
    // being opened or closed — the two surfaces shouldn't coexist since
    // the queue sits over the lyrics column.
    setIsQueueOpen(false);
    setIsLyricsOpen((prev) => {
      const next = !prev;
      if (next) setIsNowPlayingOpen(true);
      return next;
    });
  }, []);

  // Independent surface: opening it does not open Now Playing, and closing
  // Now Playing does not affect it. It renders over whatever page is behind.
  const toggleQueue = useCallback(() => {
    setIsQueueOpen((prev) => !prev);
  }, []);

  const openPlaylistDetail = useCallback((playlistId: string) => {
    setViewingPlaylist({ id: playlistId, autoPlay: false });
  }, []);

  const openPlaylistAutoPlay = useCallback((playlistId: string) => {
    setViewingPlaylist({ id: playlistId, autoPlay: true });
  }, []);

  const searchForArtist = useCallback((name: string) => {
    setViewingPlaylist(null);
    setIsNowPlayingOpen(false);
    setPendingSearchQuery(name);
    setCurrentPath('search');
  }, []);

  // Hide the YTM window as soon as we confirm the user is signed in. Without
  // this the window lingers from its .visible(true) startup state (issue #51).
  useEffect(() => {
    if (loginState === true) {
      ytmApi.hideYtm().catch(() => {
        // If hiding fails, the YTM window stays — non-fatal.
      });
    }
  }, [loginState]);

  // While we don't know the login state, the WelcomeScreen is the only thing
  // on screen — no neutral "Loading…" flash.
  if (loginState === null && !loginOverride) {
    return <WelcomeScreen isDone={false} />;
  }

  if (!isLoggedIn) {
    // Once we know the user is signed out, the LoginPage is ready to render
    // behind the fading WelcomeScreen.
    return (
      <>
        <LoginPage onLoggedIn={() => setLoginOverride(true)} />
        <WelcomeScreen isDone />
      </>
    );
  }

  const renderPage = () => {
    if (currentPath === 'search') {
      return (
        <SearchPage
          onOpenPlaylist={openPlaylistDetail}
          onAutoPlayPlaylist={openPlaylistAutoPlay}
          pendingQuery={pendingSearchQuery}
          onPendingQueryConsumed={() => setPendingSearchQuery(null)}
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
          onSearchArtist={searchForArtist}
          refreshKey={libraryVersion}
        />
      );
    }
    return (
      <HomePage
        onOpenPlaylist={openPlaylistDetail}
        onAutoPlayPlaylist={openPlaylistAutoPlay}
        onReady={handleHomeReady}
      />
    );
  };

  return (
    <>
    <AppShell
      currentPath={currentPath}
      onNavigate={(path) => {
        setViewingPlaylist(null);
        setIsNowPlayingOpen(false);
        setIsQueueOpen(false);
        // Settings tab toggles: clicking it while open returns to the
        // previous view instead of re-rendering the same page.
        if (path === 'settings' && currentPath === 'settings') {
          const fallback = previousPathRef.current === 'settings'
            ? 'home'
            : previousPathRef.current;
          setCurrentPath(fallback);
          return;
        }
        if (path !== currentPath) {
          previousPathRef.current = currentPath;
        }
        setCurrentPath(path);
      }}
      nowPlayingOpen={isNowPlayingOpen}
      onToggleNowPlaying={toggleNowPlaying}
      lyricsOpen={isLyricsOpen}
      onToggleLyrics={toggleLyrics}
      queueOpen={isQueueOpen}
      onToggleQueue={toggleQueue}
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
              onLibraryChanged={handleLibraryChanged}
            />
          </div>
        )}
      </div>
    </AppShell>
    <WelcomeScreen isDone={isHomeReady} />
    </>
  );
};

export default App;
