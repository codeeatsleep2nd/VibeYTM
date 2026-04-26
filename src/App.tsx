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
import { UpdateBanner } from './components/UpdateBanner';
import { useBootState } from './hooks/useBootState';
import { ytmApi } from './lib/ipc';

interface ViewingPlaylist {
  id: string;
  autoPlay: boolean;
}

const App: FC = () => {
  // Boot orchestrator: tri-state phase (loading|login|app) plus the
  // splash-fade gate. Replaces the three intertwined flags App used to
  // juggle (loginState / loginOverride / isHomeReady). See
  // useBootState.ts for the state-machine contract; useBootState.test.ts
  // pins down each transition.
  const { phase, isSplashDone, markHomeReady, markManualLogin } =
    useBootState();
  const [currentPath, setCurrentPath] = useState('home');
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [viewingPlaylist, setViewingPlaylist] = useState<ViewingPlaylist | null>(null);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);
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

  // Hide the YTM window as soon as the boot orchestrator transitions to the
  // app phase (signed in OR manual override). Without this the window
  // lingers from its `.visible(true)` startup state (issue #51).
  useEffect(() => {
    if (phase === 'app') {
      ytmApi.hideYtm().catch(() => {
        // If hiding fails, the YTM window stays — non-fatal.
      });
    }
  }, [phase]);

  if (phase === 'loading') {
    // Sign-in state hasn't reported yet — splash is the ONLY surface so
    // we never flash either the LoginPage or the AppShell at a user
    // whose state we don't know.
    return <WelcomeScreen isDone={false} />;
  }

  if (phase === 'login') {
    // Bridge confirmed signed-out: LoginPage is ready behind the
    // splash, which fades over it.
    return (
      <>
        <LoginPage onLoggedIn={markManualLogin} />
        <WelcomeScreen isDone={isSplashDone} />
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
        onReady={markHomeReady}
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
        // Also close LRC explicitly. Inside NowPlaying, the lyrics
        // column sets `pointer-events: auto` when `showLyrics` is true,
        // which overrides the parent overlay's `pointer-events: none`
        // when the overlay is closed. Without this line the lyrics
        // column stays click-active over the new page (right side
        // of Home/Explore/Library) and steals clicks. This is the
        // "unclickable area where the play queue / lyrics page
        // appears" bug.
        setIsLyricsOpen(false);
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
    <WelcomeScreen isDone={isSplashDone} />
    <UpdateBanner />
    </>
  );
};

export default App;
