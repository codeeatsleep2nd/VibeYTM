import { type FC, useState, useCallback, useEffect, useRef } from 'react';
import './styles/global.css';
import { AppShell } from './components/layout/AppShell';
import { HomePage, resetHomePageModuleCache } from './components/pages/HomePage';
import { SearchPage } from './components/pages/SearchPage';
import { LibraryPage } from './components/pages/LibraryPage';
import { ExplorePage, resetExplorePageModuleCache } from './components/pages/ExplorePage';
import { SettingsPage } from './components/pages/SettingsPage';
import { LoginPage } from './components/pages/LoginPage';
import { PlaylistDetailPage } from './components/pages/PlaylistDetailPage';
import { ArtistPage } from './components/pages/ArtistPage';
import { HistoryPage } from './components/pages/HistoryPage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { ShortcutCheatsheet } from './components/ShortcutCheatsheet';
import { Toast } from './components/Toast';
import { AddToPlaylistPicker } from './components/contextMenu/AddToPlaylistPicker';
import { useBootState } from './hooks/useBootState';
import { useGlobalShortcuts, type ShortcutBinding } from './hooks/useGlobalShortcuts';
import { useTauriEvent } from './hooks/useTauriEvent';
import { ytmApi, playerApi } from './lib/ipc';
import { clearAllBrowseCaches } from './lib/persistentCache';
import { subscribeToLibraryMutations } from './lib/libraryMutations';
import { registerOpenArtist, registerOpenPlaylist } from './lib/appNav';
import { OverlayStateContext } from './lib/overlayState';
import type { FocusTimerState } from './components/player/FocusTimer/useFocusTimerCountdown';

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
  const [isFocusTimerOpen, setIsFocusTimerOpen] = useState(false);
  // Sidebar visibility — persisted to localStorage so the choice survives
  // launches. Read once at mount; subsequent toggles persist via
  // `toggleSidebar` below. The ⌘B shortcut is wired up alongside the
  // other global shortcuts.
  const [isSidebarVisible, setIsSidebarVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem('vibeytm:sidebar-visible') !== '0';
    } catch {
      return true;
    }
  });
  const toggleSidebar = useCallback(() => {
    setIsSidebarVisible((v) => {
      const next = !v;
      try {
        localStorage.setItem('vibeytm:sidebar-visible', next ? '1' : '0');
      } catch {
        // localStorage unavailable — value lives only in memory for this
        // session, no recovery needed.
      }
      return next;
    });
  }, []);
  // FocusTimer reports its current state up via `onStateChange`. Held
  // here so the App-level close gate (`requestCloseFocusTimer`) can
  // decide whether to prompt before any close path completes.
  const [focusTimerState, setFocusTimerState] = useState<FocusTimerState>('idle');
  // The action to run if the user confirms the "Reset focus session?"
  // modal. `null` when no confirmation is in flight.
  const [pendingFocusTimerClose, setPendingFocusTimerClose] = useState<
    (() => void) | null
  >(null);
  const focusTimerStateRef = useRef<FocusTimerState>('idle');
  const isFocusTimerOpenRef = useRef(false);
  isFocusTimerOpenRef.current = isFocusTimerOpen;
  focusTimerStateRef.current = focusTimerState;
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

  // Any login transition (sign-in OR sign-out) invalidates account-scoped
  // browse data. The page-level handlers reset state for currently-mounted
  // pages, but unmounted pages would otherwise hydrate from the previous
  // account's localStorage on their next mount — so wipe the persisted
  // browse caches and reset module-level singletons here too. Bumping
  // libraryVersion forces a refetch on whichever LibraryPage tab the user
  // lands on next (it stays mounted across tab navigation in some flows).
  useTauriEvent<boolean>('player:login-changed', () => {
    clearAllBrowseCaches();
    resetHomePageModuleCache();
    resetExplorePageModuleCache();
    setLibraryVersion((v) => v + 1);
  });

  // Library-mutation pub/sub: AddToPlaylistPicker, PlaylistDetailPage
  // (remove track), and any future mutator calls `notifyLibraryMutated()`
  // after a successful mutation. Bumping libraryVersion here forces
  // LibraryPage to refetch the open tab even if it's mounted behind a
  // detail overlay.
  useEffect(() => {
    return subscribeToLibraryMutations(handleLibraryChanged);
  }, [handleLibraryChanged]);
  // Remembered so "Settings → Settings" toggles back to where the user was.
  const previousPathRef = useRef<string>('home');

  // Single gate funnel for any close path that would either (a) close
  // the focus-timer overlay or (b) supersede it (sidebar nav, opening
  // a different overlay, etc.). When the timer is running, the gate
  // queues the action behind a confirmation modal — once confirmed,
  // we close the timer AND run the original action. Idle/done close
  // paths just run the action immediately. Reads via refs so the
  // helper's identity stays stable across timer ticks.
  const requestCloseFocusTimer = useCallback((action: () => void) => {
    if (
      isFocusTimerOpenRef.current
      && focusTimerStateRef.current === 'running'
    ) {
      setPendingFocusTimerClose(() => action);
      return;
    }
    action();
  }, []);

  // Lock out rapid second toggles within the animation window so a stray
  // double-click never makes the overlay flash open-and-close.
  const lastToggleAtRef = useRef(0);
  const isNowPlayingOpenRef = useRef(false);
  isNowPlayingOpenRef.current = isNowPlayingOpen;
  const toggleNowPlaying = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleAtRef.current < 450) return;
    lastToggleAtRef.current = now;
    // Closing NowPlaying never touches the focus timer — just toggle.
    if (isNowPlayingOpenRef.current) {
      setIsNowPlayingOpen(false);
      // When closing, also clear the LRC selected status so the bottom
      // bar's lyrics button no longer renders as active. Without this,
      // the LRC button stays highlighted after the user has dismissed
      // the playing page, making its state look out of sync with what's
      // actually on screen.
      setIsLyricsOpen(false);
      return;
    }
    // Opening NowPlaying supersedes the focus timer — funnel through
    // the App-level gate so a running timer prompts before being
    // overlaid by the playing page.
    requestCloseFocusTimer(() => {
      setIsFocusTimerOpen(false);
      setIsNowPlayingOpen(true);
    });
  }, [requestCloseFocusTimer]);

  // Lyrics is its own top-level overlay (LyricsOverlay) — toggling it
  // no longer mounts the Now Playing page. Each overlay (Now Playing,
  // Lyrics, Queue) owns its own visibility independently.
  const toggleLyrics = useCallback(() => {
    // Clicking LRC always dismisses the queue drawer, whether lyrics is
    // being opened or closed — the two surfaces shouldn't coexist since
    // they share the same right-slot geometry.
    setIsQueueOpen(false);
    setIsLyricsOpen((prev) => !prev);
  }, []);

  // Independent surface: opening it does not open Now Playing, and closing
  // Now Playing does not affect it. It renders over whatever page is behind.
  // Mirrors `toggleLyrics`: clicking the queue button always dismisses the
  // lyrics drawer (whether queue is being opened or closed) — the two
  // surfaces share the same right-slot geometry and shouldn't coexist.
  const toggleQueue = useCallback(() => {
    setIsLyricsOpen(false);
    setIsQueueOpen((prev) => !prev);
  }, []);

  // Focus timer takes over the main surface — opening it closes the
  // other right-side overlays (NowPlaying, Lyrics, Queue) so the
  // focus session is the user's sole focal point. Closing while
  // running funnels through the gate above so the user can confirm.
  const toggleFocusTimer = useCallback(() => {
    if (isFocusTimerOpenRef.current) {
      requestCloseFocusTimer(() => setIsFocusTimerOpen(false));
      return;
    }
    setIsNowPlayingOpen(false);
    setIsLyricsOpen(false);
    setIsQueueOpen(false);
    setIsFocusTimerOpen(true);
  }, [requestCloseFocusTimer]);

  const openPlaylistDetail = useCallback((playlistId: string) => {
    setViewingPlaylist({ id: playlistId, autoPlay: false });
  }, []);

  const openPlaylistAutoPlay = useCallback((playlistId: string) => {
    setViewingPlaylist({ id: playlistId, autoPlay: true });
  }, []);

  const searchForArtist = useCallback((name: string) => {
    requestCloseFocusTimer(() => {
      // Closes other overlays so the artist hero is the focus.
      setViewingPlaylist(null);
      setIsNowPlayingOpen(false);
      setIsLyricsOpen(false);
      setIsQueueOpen(false);
      setIsFocusTimerOpen(false);
      setViewingArtist(name);
    });
  }, [requestCloseFocusTimer]);

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

  // Mirror NowPlaying's open state onto a body class so CSS rules
  // outside the React tree (e.g. DetailPageHero's portaled back
  // button) can react. The existing `body:has(...)` rule in global.css
  // can flake in WKWebView; the class is a deterministic backup.
  useEffect(() => {
    document.body.classList.toggle(
      'vibeytm-nowplaying-open',
      isNowPlayingOpen,
    );
  }, [isNowPlayingOpen]);

  // Register the app-level "open artist" navigation hook so the track
  // context menu can drive it without prop-drilling. Re-registers on
  // every mount of the App-level callback identity; deregisters on
  // unmount so a stale closure can't fire after a HMR replacement.
  useEffect(() => {
    registerOpenArtist(searchForArtist);
    return () => registerOpenArtist(null);
  }, [searchForArtist]);

  // Same registry pattern for "open playlist / show". Used by the Now
  // Playing overlay's artist-line click to jump to a podcast show's
  // MPSP detail page. Closes every overlay first so the playlist page
  // is the focus once it opens.
  useEffect(() => {
    const handler = (playlistId: string): void => {
      requestCloseFocusTimer(() => {
        setIsNowPlayingOpen(false);
        setIsLyricsOpen(false);
        setIsQueueOpen(false);
        setIsFocusTimerOpen(false);
        setViewingArtist(null);
        openPlaylistDetail(playlistId);
      });
    };
    registerOpenPlaylist(handler);
    return () => registerOpenPlaylist(null);
  }, [openPlaylistDetail, requestCloseFocusTimer]);

  // Global keyboard shortcuts. Active only in the app phase (no point
  // intercepting Cmd+L while the LoginPage is up). Bindings stay as a
  // const-array — `useGlobalShortcuts` re-attaches the listener when
  // it changes, so any state captured by the callbacks is current.
  const goSidebar = useCallback((path: string) => {
    requestCloseFocusTimer(() => {
      setViewingPlaylist(null);
      setIsNowPlayingOpen(false);
      setIsQueueOpen(false);
      setIsLyricsOpen(false);
      setIsFocusTimerOpen(false);
      setCurrentPath(path);
    });
  }, [requestCloseFocusTimer]);
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
          key: 'b',
          meta: true,
          label: 'Toggle sidebar',
          hint: '⌘B',
          onActivate: toggleSidebar,
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
    if (currentPath === 'history') return <HistoryPage />;
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
    <OverlayStateContext.Provider
      value={{
        nowPlayingOpen: isNowPlayingOpen,
        focusTimerOpen: isFocusTimerOpen,
      }}
    >
    <AppShell
      currentPath={currentPath}
      onNavigate={(path) => {
        requestCloseFocusTimer(() => {
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
          setIsFocusTimerOpen(false);
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
        });
      }}
      nowPlayingOpen={isNowPlayingOpen}
      onToggleNowPlaying={toggleNowPlaying}
      lyricsOpen={isLyricsOpen}
      onToggleLyrics={toggleLyrics}
      queueOpen={isQueueOpen}
      onToggleQueue={toggleQueue}
      focusTimerOpen={isFocusTimerOpen}
      onToggleFocusTimer={toggleFocusTimer}
      onFocusTimerStateChange={setFocusTimerState}
      onFocusTimerClose={() =>
        requestCloseFocusTimer(() => setIsFocusTimerOpen(false))
      }
      sidebarVisible={isSidebarVisible}
      onToggleSidebar={toggleSidebar}
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
    </OverlayStateContext.Provider>
    <WelcomeScreen isDone={isSplashDone} />
    <UpdateBanner />
    <Toast />
    <AddToPlaylistPicker />
    <ShortcutCheatsheet
      isOpen={isCheatsheetOpen}
      onClose={() => setIsCheatsheetOpen(false)}
      bindings={shortcutBindings}
    />
    {pendingFocusTimerClose && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-confirm-title"
        aria-describedby="focus-confirm-desc"
        onClick={() => setPendingFocusTimerClose(null)}
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'oklch(0% 0 0 / 0.45)',
          backdropFilter: 'var(--glass-recipe-strong)',
          WebkitBackdropFilter: 'var(--glass-recipe-strong)',
          zIndex: 300,
          padding: 'var(--space-6)',
          animation: 'fadeIn 150ms var(--ease-out, ease-out)',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 360,
            maxWidth: '100%',
            background: 'oklch(20% 0 0 / 0.96)',
            border: '1px solid oklch(100% 0 0 / 0.08)',
            borderRadius: 16,
            padding: '28px 28px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 0,
            boxShadow:
              '0 24px 60px oklch(0% 0 0 / 0.55), 0 0 0 1px oklch(100% 0 0 / 0.04) inset',
          }}
        >
          {/* Icon — accent-tinted clock circle, sized for a 64x64 hit
              area but rendered visually at 48x48 to match macOS HIG
              alert iconography. */}
          <div
            aria-hidden
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
              marginBottom: 16,
              background: 'oklch(from var(--color-accent) l c h / 0.16)',
              color: 'var(--color-accent)',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>

          <h2
            id="focus-confirm-title"
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              textAlign: 'center',
              letterSpacing: '-0.01em',
              lineHeight: 1.3,
            }}
          >
            Reset focus session?
          </h2>

          <p
            id="focus-confirm-desc"
            style={{
              margin: '8px 0 24px',
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            Leaving this page will reset the countdown. You'll need to
            start a new session.
          </p>

          <div
            style={{
              display: 'flex',
              gap: 8,
              width: '100%',
            }}
          >
            <button
              type="button"
              autoFocus
              onClick={() => setPendingFocusTimerClose(null)}
              style={{
                flex: 1,
                height: 36,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                background: 'oklch(100% 0 0 / 0.06)',
                border: '1px solid oklch(100% 0 0 / 0.08)',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'background var(--duration-fast) var(--ease-out)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'oklch(100% 0 0 / 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'oklch(100% 0 0 / 0.06)';
              }}
            >
              Keep going
            </button>
            <button
              type="button"
              onClick={() => {
                const action = pendingFocusTimerClose;
                setPendingFocusTimerClose(null);
                setIsFocusTimerOpen(false);
                action?.();
              }}
              style={{
                flex: 1,
                height: 36,
                fontSize: 13,
                fontWeight: 600,
                color: 'white',
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'opacity var(--duration-fast) var(--ease-out)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.88';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              Reset & exit
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default App;
