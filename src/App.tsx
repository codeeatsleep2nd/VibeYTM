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
import { ArtistPage } from './components/pages/ArtistPage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { ShortcutCheatsheet } from './components/ShortcutCheatsheet';
import { useBootState } from './hooks/useBootState';
import { useGlobalShortcuts, type ShortcutBinding } from './hooks/useGlobalShortcuts';
import { useLiquidGL } from './hooks/useLiquidGL';
import { ytmApi, playerApi } from './lib/ipc';
import { registerOpenArtist } from './lib/appNav';

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
  const [viewingArtist, setViewingArtist] = useState<string | null>(null);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);
  const [isCheatsheetOpen, setIsCheatsheetOpen] = useState(false);
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
    // Promoted from a search redirect to a real overlay page (P3.1).
    // Closes other overlays so the artist hero is the focus.
    setViewingPlaylist(null);
    setIsNowPlayingOpen(false);
    setIsLyricsOpen(false);
    setIsQueueOpen(false);
    setViewingArtist(name);
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

  // Register the app-level "open artist" navigation hook so the track
  // context menu can drive it without prop-drilling. Re-registers on
  // every mount of the App-level callback identity; deregisters on
  // unmount so a stale closure can't fire after a HMR replacement.
  useEffect(() => {
    registerOpenArtist(searchForArtist);
    return () => registerOpenArtist(null);
  }, [searchForArtist]);

  // liquidGL real-refraction glass on chrome + queue drawer. Both
  // surfaces tag themselves with `.liquidGL-pane`; the singleton
  // WebGL renderer manages them together. Gated on the `app` boot
  // phase so we don't initialise behind the WelcomeScreen / login —
  // the targets aren't in the DOM yet at those phases. Hook is
  // idempotent across re-renders (internal initializedRef).
  // Tuned so the glass character reads at a glance against YTM's mostly
  // dark backgrounds:
  //   refraction 0.025 — strong enough to bend visible carousel edges
  //                      behind the chrome.
  //   bevelDepth/Width — pronounced rim catches whatever light bleeds
  //                      through, drawing the glass plate.
  //   frost 0.18      — frosted layer keeps content recognisable while
  //                      clearly marking the surface as glass.
  //   specular        — highlight gleam on top.
  // Defaults from naughtyduk/liquidGL (refraction 0.01, frost 0) read
  // as "almost transparent" against dark surfaces — barely a UI change.
  useLiquidGL(
    {
      target: '.liquidGL-pane',
      refraction: 0.025,
      bevelDepth: 0.18,
      bevelWidth: 0.22,
      frost: 0.18,
      shadow: true,
      specular: true,
      reveal: 'fade',
    },
    phase === 'app',
  );

  // Global keyboard shortcuts. Active only in the app phase (no point
  // intercepting Cmd+L while the LoginPage is up). Bindings stay as a
  // const-array — `useGlobalShortcuts` re-attaches the listener when
  // it changes, so any state captured by the callbacks is current.
  const goSidebar = useCallback((path: string) => {
    setViewingPlaylist(null);
    setIsNowPlayingOpen(false);
    setIsQueueOpen(false);
    setIsLyricsOpen(false);
    setCurrentPath(path);
  }, []);
  const shortcutBindings: ShortcutBinding[] = phase === 'app'
    ? [
        {
          key: ' ',
          label: 'Toggle play / pause',
          hint: 'Space',
          onActivate: () => playerApi.togglePlay().catch(() => {}),
        },
        {
          key: 'l',
          meta: true,
          label: 'Toggle lyrics',
          hint: '⌘L',
          onActivate: toggleLyrics,
        },
        {
          key: 'q',
          meta: true,
          label: 'Toggle queue',
          hint: '⌘Q',
          onActivate: toggleQueue,
        },
        {
          key: 'f',
          meta: true,
          label: 'Search',
          hint: '⌘F',
          onActivate: () => goSidebar('search'),
        },
        {
          key: '1',
          meta: true,
          label: 'Home',
          hint: '⌘1',
          onActivate: () => goSidebar('home'),
        },
        {
          key: '2',
          meta: true,
          label: 'Search',
          hint: '⌘2',
          onActivate: () => goSidebar('search'),
        },
        {
          key: '3',
          meta: true,
          label: 'Explore',
          hint: '⌘3',
          onActivate: () => goSidebar('explore'),
        },
        {
          key: '4',
          meta: true,
          label: 'Library',
          hint: '⌘4',
          onActivate: () => goSidebar('library'),
        },
        {
          key: ',',
          meta: true,
          label: 'Settings',
          hint: '⌘,',
          onActivate: () => goSidebar('settings'),
        },
        {
          key: '/',
          meta: true,
          label: 'Show keyboard shortcuts',
          hint: '⌘/',
          onActivate: () => setIsCheatsheetOpen((v) => !v),
        },
        {
          key: '?',
          shift: true,
          label: 'Show keyboard shortcuts',
          hint: '?',
          onActivate: () => setIsCheatsheetOpen((v) => !v),
        },
      ]
    : [];
  useGlobalShortcuts(shortcutBindings);

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
      // library, library/playlists, library/songs, library/albums,
      // library/artists, library/podcasts
      const sub = currentPath.split('/')[1] as
        | 'playlists'
        | 'songs'
        | 'albums'
        | 'artists'
        | 'podcasts'
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
        setViewingArtist(null);
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
        {viewingArtist && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--color-bg)',
              zIndex: 21,
            }}
          >
            <ArtistPage
              artistName={viewingArtist}
              onBack={() => setViewingArtist(null)}
              onOpenAlbum={(browseId) => {
                setViewingArtist(null);
                openPlaylistDetail(browseId);
              }}
            />
          </div>
        )}
      </div>
    </AppShell>
    <WelcomeScreen isDone={isSplashDone} />
    <UpdateBanner />
    <ShortcutCheatsheet
      isOpen={isCheatsheetOpen}
      onClose={() => setIsCheatsheetOpen(false)}
      bindings={shortcutBindings}
    />
    </>
  );
};

export default App;
