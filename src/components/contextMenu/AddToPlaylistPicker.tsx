import {
  type FC,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ChevronLeft,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { browseApi } from '../../lib/ipc';
import {
  closeAddToPlaylistPicker,
  useAddToPlaylistRequest,
} from '../../lib/addToPlaylistRegistry';
import { useLoginState } from '../../hooks/useLoginState';
import {
  notifyLibraryMutated,
  subscribeToLibraryMutations,
} from '../../lib/libraryMutations';
import { toast } from '../../lib/toast';
import { CachedImage } from '../CachedImage';
import type { PlaylistPrivacy, PlaylistSummary } from '../../lib/types';

// ---------------------------------------------------------------------------
// Module-level playlist cache (eng-review Q1)
//
// Stale-while-revalidate: a 60s TTL covers normal UX (open the picker
// twice in a session) without stranding the user on out-of-date counts
// after they create a new playlist. Cleared whenever a successful
// add/create mutation lands so subsequent opens see the new state.
// ---------------------------------------------------------------------------
const PLAYLIST_TTL_MS = 60 * 1000;
let playlistCache: PlaylistSummary[] | null = null;
let playlistCacheAt = 0;

function isCacheFresh(): boolean {
  return (
    playlistCache !== null && Date.now() - playlistCacheAt < PLAYLIST_TTL_MS
  );
}

function setPlaylistCache(playlists: PlaylistSummary[]): void {
  playlistCache = playlists;
  playlistCacheAt = Date.now();
}

function invalidatePlaylistCache(): void {
  playlistCache = null;
  playlistCacheAt = 0;
}

// Track-level mutations elsewhere in the app (e.g. PlaylistDetailPage's
// "Remove from playlist" trash button) change the trackCount that the
// picker shows next to each row. Without this subscription the picker
// would happily render stale counts from a fresh-looking 60s cache for
// up to a full minute after a remove. The picker's own add/create/delete
// already invalidate inline; this catches everything else that calls
// `notifyLibraryMutated()`.
subscribeToLibraryMutations(invalidatePlaylistCache);

/** Test-only — clear all module state. */
export function __resetAddToPlaylistPickerForTests(): void {
  invalidatePlaylistCache();
}

// ---------------------------------------------------------------------------
// Geometry: pin to anchor with viewport-flip (mirrors ContextMenu.tsx)
// ---------------------------------------------------------------------------
const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 480;
const VIEWPORT_MARGIN = 8;

interface AnchoredPosition {
  left: number;
  top: number;
}

function computeAnchoredPosition(
  cursor: { x: number; y: number },
  measured: { w: number; h: number },
): AnchoredPosition {
  const { innerWidth: vw, innerHeight: vh } = window;
  let left = cursor.x;
  let top = cursor.y;
  if (left + measured.w + VIEWPORT_MARGIN > vw) {
    left = Math.max(VIEWPORT_MARGIN, cursor.x - measured.w);
  }
  if (top + measured.h + VIEWPORT_MARGIN > vh) {
    top = Math.max(VIEWPORT_MARGIN, cursor.y - measured.h);
  }
  return {
    left: Math.max(VIEWPORT_MARGIN, left),
    top: Math.max(VIEWPORT_MARGIN, top),
  };
}

// ---------------------------------------------------------------------------
// Filter heuristic: hide YTM auto-generated playlists.
// User playlists owned by the signed-in account come back with playlistId
// starting `VL...` (browse-prefixed) or `PL...`. YTM mixes / radio queues
// (`RD...`) and other auto-generated entries shouldn't appear as add-targets
// since they're not editable.
// ---------------------------------------------------------------------------
function isUserEditablePlaylist(p: PlaylistSummary): boolean {
  if (!p.playlistId) return false;
  if (p.playlistId.startsWith('RD')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// View states
// ---------------------------------------------------------------------------
type View = 'list' | 'create';
type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; playlists: PlaylistSummary[] }
  | { kind: 'error'; message: string };

// Track count formatter — 1/N/null all read cleanly.
function formatTrackCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n === 1) return '1 track';
  return `${n} tracks`;
}

// ---------------------------------------------------------------------------
// Top-level component — mount once at App.tsx
// ---------------------------------------------------------------------------
export const AddToPlaylistPicker: FC = () => {
  const request = useAddToPlaylistRequest();
  if (request === null) return null;
  // The keyed remount semantics here are deliberate: when the registry
  // value flips to a new track (eng-review A2), React unmounts the old
  // picker and mounts a fresh one. View state, search query, and pending
  // IPCs are all reset for the new track. Position re-anchors via the
  // new request.position. Cleaner than bolting reset logic onto a
  // long-lived instance.
  return <PickerInner key={request.videoId} request={request} />;
};

interface PickerInnerProps {
  request: NonNullable<ReturnType<typeof useAddToPlaylistRequest>>;
}

const PickerInner: FC<PickerInnerProps> = ({ request }) => {
  const loggedIn = useLoginState();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const [view, setView] = useState<View>('list');
  const [query, setQuery] = useState('');
  const [fetchState, setFetchState] = useState<FetchState>(() =>
    isCacheFresh()
      ? { kind: 'ready', playlists: playlistCache ?? [] }
      : { kind: 'idle' },
  );
  const [pending, setPending] = useState(false);
  const [name, setName] = useState('Untitled playlist');
  const [privacy, setPrivacy] = useState<PlaylistPrivacy>('PRIVATE');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  /** Playlist queued for deletion confirmation. The row morphs to an
   *  inline confirm strip while this is set; null otherwise. */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [position, setPosition] = useState<AnchoredPosition>({
    left: request.position.x,
    top: request.position.y,
  });

  // Capture which element opened the picker so we can return focus on
  // close (a11y: focus-return contract).
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      openerRef.current?.focus?.();
    };
  }, []);

  // ---- Fetch playlists if we don't have a fresh cache hit. -------------
  const fetchPlaylists = useCallback(() => {
    if (loggedIn === false) return;
    setFetchState({ kind: 'loading' });
    browseApi
      .getLibraryPlaylists()
      .then((playlists) => {
        setPlaylistCache(playlists);
        setFetchState({ kind: 'ready', playlists });
      })
      .catch((e: unknown) => {
        const message =
          e instanceof Error ? e.message : 'Failed to load playlists';
        setFetchState({ kind: 'error', message });
      });
  }, [loggedIn]);

  useEffect(() => {
    if (fetchState.kind === 'idle' && loggedIn !== false) {
      fetchPlaylists();
    }
  }, [fetchState.kind, fetchPlaylists, loggedIn]);

  // ---- Re-anchor position to viewport after we know our size. ----------
  useLayoutEffect(() => {
    const node = popoverRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition(
      computeAnchoredPosition(request.position, {
        w: rect.width,
        h: rect.height,
      }),
    );
  }, [request.position]);

  // ---- Outside click + Escape + scroll close. ---------------------------
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      const node = popoverRef.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      closeAddToPlaylistPicker();
    };
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAddToPlaylistPicker();
      }
    };
    const handleScroll = (e: Event): void => {
      const node = popoverRef.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      closeAddToPlaylistPicker();
    };
    // Schedule on next tick so the click that opened the menu doesn't
    // immediately close it (ContextMenu pattern).
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClick, true);
      document.addEventListener('keydown', handleKey, true);
      document.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', closeAddToPlaylistPicker);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', closeAddToPlaylistPicker);
    };
  }, []);

  // ---- Focus management on view change. ---------------------------------
  useEffect(() => {
    if (loggedIn === false) return;
    const id = window.setTimeout(() => {
      if (view === 'list') {
        searchInputRef.current?.focus();
      } else {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }
    }, 16);
    return () => window.clearTimeout(id);
  }, [view, loggedIn]);

  // ---- Filtered playlist list. -----------------------------------------
  const filtered = useMemo(() => {
    if (fetchState.kind !== 'ready') return [];
    const editable = fetchState.playlists.filter(isUserEditablePlaylist);
    const q = query.trim().toLowerCase();
    if (!q) return editable;
    return editable.filter((p) => p.title.toLowerCase().includes(q));
  }, [fetchState, query]);

  // ---- Add a track to an existing playlist. -----------------------------
  const handlePickPlaylist = async (
    playlistId: string,
    playlistTitle: string,
  ): Promise<void> => {
    if (pending) return;
    setPending(true);
    setErrorBanner(null);
    try {
      const added = await browseApi.addTrackToPlaylist(
        playlistId,
        request.videoId,
      );
      // Mutation invalidates the cache so a subsequent re-open shows the
      // updated track count. Skip-because-duplicate intentionally still
      // invalidates: the cache is cheap to refresh and a stale entry
      // would mislead the next opener about what's already in there.
      invalidatePlaylistCache();
      if (added) {
        // Real add — library snapshot changed too (track count bumped).
        notifyLibraryMutated();
        toast.show({ message: `Added to ${playlistTitle}` });
      } else {
        // YTM deduped — the user re-added a track that was already in
        // the playlist. Match YTM Web's own copy here so the outcome
        // reads as "no-op", not "succeeded".
        toast.show({ message: `Already in ${playlistTitle}` });
      }
      closeAddToPlaylistPicker();
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Could not add track. Try again?';
      setErrorBanner(message);
      setPending(false);
    }
  };

  // ---- Delete a playlist. -----------------------------------------------
  const handleConfirmDelete = async (
    playlistId: string,
    playlistTitle: string,
  ): Promise<void> => {
    if (pending) return;
    setPending(true);
    setErrorBanner(null);
    try {
      await browseApi.deletePlaylist(playlistId);
      invalidatePlaylistCache();
      // Update the in-memory list immediately so the row disappears
      // instead of flashing back to its pre-delete state during the
      // next list re-render.
      if (fetchState.kind === 'ready') {
        setFetchState({
          kind: 'ready',
          playlists: fetchState.playlists.filter(
            (p) => p.playlistId !== playlistId,
          ),
        });
      }
      setPendingDeleteId(null);
      setPending(false);
      // LibraryPage's Playlists tab needs to drop this row from its
      // grid even if the user has it open behind the picker.
      notifyLibraryMutated();
      toast.show({ message: `Deleted ${playlistTitle}` });
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : 'Could not delete playlist. Try again?';
      setErrorBanner(message);
      setPending(false);
    }
  };

  // ---- Create new playlist with this track as the seed. -----------------
  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || pending) return;
    setPending(true);
    setErrorBanner(null);
    try {
      await browseApi.createPlaylist(trimmed, '', privacy, request.videoId);
      invalidatePlaylistCache();
      notifyLibraryMutated();
      toast.show({ message: `Added to ${trimmed}` });
      closeAddToPlaylistPicker();
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : 'Could not create playlist. Try again?';
      setErrorBanner(message);
      setPending(false);
    }
  };

  // ---- Render. ----------------------------------------------------------
  const containerStyle: CSSProperties = {
    position: 'fixed',
    left: position.left,
    top: position.top,
    width: POPOVER_WIDTH,
    maxHeight: `min(60vh, ${POPOVER_MAX_HEIGHT}px)`,
    zIndex: 280,
    display: 'flex',
    flexDirection: 'column',
    // Solid-enough wash so playlist names + form fields stay readable
    // against busy album-art backgrounds. The glass-bg-card token is
    // 30% alpha — too transparent for a popover the user has to read.
    // No `backdrop-filter` here: this popover may stack on top of
    // NowPlaying (e.g. right-click a queue row), and stacked filters
    // trigger issue #99's WKWebView paint feedback loop. The 96%-alpha
    // dark base + subtle top tint give the glass-rim feel without an
    // extra filter layer.
    background:
      'linear-gradient(180deg, oklch(100% 0 0 / 0.04) 0%, oklch(100% 0 0 / 0) 30%), oklch(14% 0.005 270 / 0.96)',
    boxShadow: 'var(--glass-plate-shadow)',
    border: '1px solid var(--glass-rim-mid)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-3)',
    overflow: 'hidden',
    color: 'var(--color-text-primary)',
    userSelect: 'none',
  };

  const isCreate = view === 'create';

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={isCreate ? 'New playlist' : 'Add to playlist'}
      style={containerStyle}
    >
      <PopoverHeader
        title={isCreate ? 'New playlist' : 'Add to playlist'}
        onBack={isCreate ? () => setView('list') : null}
        onClose={() => closeAddToPlaylistPicker()}
      />

      {errorBanner !== null && (
        <ErrorBanner
          message={errorBanner}
          onRetry={() => setErrorBanner(null)}
        />
      )}

      {loggedIn === false ? (
        <SignedOutNotice />
      ) : isCreate ? (
        <CreateView
          name={name}
          onNameChange={setName}
          privacy={privacy}
          onPrivacyChange={setPrivacy}
          pending={pending}
          onCancel={() => setView('list')}
          onCreate={handleCreate}
          nameInputRef={nameInputRef}
        />
      ) : (
        <ListView
          fetchState={fetchState}
          query={query}
          onQueryChange={setQuery}
          filtered={filtered}
          pending={pending}
          pendingDeleteId={pendingDeleteId}
          onPickNewPlaylist={() => setView('create')}
          onPickPlaylist={handlePickPlaylist}
          onRequestDelete={setPendingDeleteId}
          onConfirmDelete={handleConfirmDelete}
          onCancelDelete={() => setPendingDeleteId(null)}
          onRetry={fetchPlaylists}
          searchInputRef={searchInputRef}
        />
      )}
    </div>,
    document.body,
  );
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
const PopoverHeader: FC<{
  title: string;
  onBack: (() => void) | null;
  onClose: () => void;
}> = ({ title, onBack, onClose }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      paddingBottom: 'var(--space-3)',
      borderBottom: '1px solid var(--glass-rim-dim)',
    }}
  >
    {onBack !== null && (
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        style={iconButtonStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'oklch(100% 0 0 / 0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <ChevronLeft size={16} />
      </button>
    )}
    <h2
      style={{
        margin: 0,
        flex: 1,
        fontSize: 'var(--text-base)',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        color: 'var(--color-text-primary)',
      }}
    >
      {title}
    </h2>
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      style={iconButtonStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'oklch(100% 0 0 / 0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <X size={14} />
    </button>
  </div>
);

const iconButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background var(--duration-fast) var(--ease-out)',
};

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------
interface ListViewProps {
  fetchState: FetchState;
  query: string;
  onQueryChange: (q: string) => void;
  filtered: PlaylistSummary[];
  pending: boolean;
  pendingDeleteId: string | null;
  onPickNewPlaylist: () => void;
  onPickPlaylist: (playlistId: string, title: string) => void;
  onRequestDelete: (playlistId: string) => void;
  onConfirmDelete: (playlistId: string, title: string) => void;
  onCancelDelete: () => void;
  onRetry: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

const ListView: FC<ListViewProps> = ({
  fetchState,
  query,
  onQueryChange,
  filtered,
  pending,
  pendingDeleteId,
  onPickNewPlaylist,
  onPickPlaylist,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onRetry,
  searchInputRef,
}) => {
  const isLoading = fetchState.kind === 'loading' || fetchState.kind === 'idle';
  const hasResult = fetchState.kind === 'ready';
  const isEmpty = hasResult && filtered.length === 0 && query.trim() === '';
  const allEditable =
    fetchState.kind === 'ready'
      ? fetchState.playlists.filter(isUserEditablePlaylist)
      : [];
  const showZeroState = isEmpty && allEditable.length === 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        paddingTop: 'var(--space-3)',
        flex: 1,
        minHeight: 0,
      }}
    >
      <NewPlaylistRow onClick={onPickNewPlaylist} prominent={showZeroState} />

      {!showZeroState && (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            background: 'var(--glass-tile-bg)',
            boxShadow: 'var(--glass-tile-shadow-rest)',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--color-border)',
            paddingLeft: 'var(--space-3)',
          }}
        >
          <Search size={14} color="var(--color-text-tertiary)" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search your playlists…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-sm)',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-primary)',
              outline: 'none',
            }}
          />
        </div>
      )}

      <div
        role="listbox"
        aria-label="Your playlists"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          marginTop: 'var(--space-1)',
        }}
      >
        {fetchState.kind === 'error' && (
          <ErrorBanner message={fetchState.message} onRetry={onRetry} />
        )}
        {isLoading && <SkeletonRows />}
        {hasResult && !showZeroState && filtered.length === 0 && (
          <div
            style={{
              padding: 'var(--space-4)',
              textAlign: 'center',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            No matches for &ldquo;{query}&rdquo;
          </div>
        )}
        {hasResult && showZeroState && (
          <div
            style={{
              padding: 'var(--space-4) var(--space-3)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 'var(--text-base)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
                marginBottom: 'var(--space-1)',
              }}
            >
              No playlists yet
            </div>
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              Create one to start organizing your music.
            </div>
          </div>
        )}
        {hasResult &&
          !showZeroState &&
          filtered.map((p) =>
            pendingDeleteId === p.playlistId ? (
              <ConfirmDeleteRow
                key={p.playlistId}
                title={p.title}
                pending={pending}
                onConfirm={() => onConfirmDelete(p.playlistId, p.title)}
                onCancel={onCancelDelete}
              />
            ) : (
              <PlaylistRow
                key={p.playlistId}
                playlist={p}
                pending={pending}
                onClick={() => onPickPlaylist(p.playlistId, p.title)}
                onDelete={() => onRequestDelete(p.playlistId)}
              />
            ),
          )}
      </div>
    </div>
  );
};

const NewPlaylistRow: FC<{ onClick: () => void; prominent: boolean }> = ({
  onClick,
  prominent,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label="Create new playlist"
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: prominent ? 'var(--space-3) var(--space-3)' : 'var(--space-2) var(--space-3)',
      background: 'var(--glass-tile-bg)',
      boxShadow: 'var(--glass-tile-shadow-rest)',
      border: 'none',
      borderRadius: 'var(--radius-md)',
      color: 'var(--color-accent)',
      fontSize: 'var(--text-sm)',
      fontWeight: 600,
      cursor: 'pointer',
      textAlign: 'left',
      width: '100%',
      transition:
        'background var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = 'var(--glass-tile-bg-active)';
      e.currentTarget.style.boxShadow = 'var(--glass-tile-shadow)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'var(--glass-tile-bg)';
      e.currentTarget.style.boxShadow = 'var(--glass-tile-shadow-rest)';
    }}
  >
    <Plus size={16} />
    <span>New playlist</span>
  </button>
);

const PlaylistRow: FC<{
  playlist: PlaylistSummary;
  pending: boolean;
  onClick: () => void;
  onDelete: () => void;
}> = ({ playlist, pending, onClick, onDelete }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={pending}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        width: '100%',
        background: hovered ? 'var(--glass-tile-bg-active)' : 'transparent',
        boxShadow: hovered ? 'var(--glass-tile-shadow)' : undefined,
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: pending ? 'wait' : 'pointer',
        opacity: pending ? 0.6 : 1,
        textAlign: 'left',
        color: 'var(--color-text-primary)',
        transition:
          'background var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          background: 'var(--color-surface-3)',
          flexShrink: 0,
        }}
      >
        {playlist.artworkUrl && (
          <CachedImage
            src={playlist.artworkUrl}
            alt=""
            loading="lazy"
            width={40}
            height={40}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'var(--color-text-primary)',
          }}
        >
          {playlist.title}
        </div>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {formatTrackCount(playlist.trackCount ?? null)}
        </div>
      </div>
      {/* Hover-revealed delete affordance. Span-role-button (NOT a real
          <button>) because the row itself is already a <button>, and
          WKWebView drops nested onClick events. */}
      <span
        role="button"
        tabIndex={hovered ? 0 : -1}
        aria-label={`Delete ${playlist.title}`}
        title="Delete playlist"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-full)',
          background: 'transparent',
          color: 'var(--color-text-tertiary)',
          flexShrink: 0,
          cursor: 'pointer',
          opacity: hovered ? 1 : 0,
          pointerEvents: hovered ? 'auto' : 'none',
          transition:
            'opacity var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            'oklch(63% 0.258 29 / 0.18)';
          (e.currentTarget as HTMLElement).style.color =
            'var(--color-accent)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
          (e.currentTarget as HTMLElement).style.color =
            'var(--color-text-tertiary)';
        }}
      >
        <Trash2 size={14} />
      </span>
    </button>
  );
};

const ConfirmDeleteRow: FC<{
  title: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, pending, onConfirm, onCancel }) => (
  <div
    role="alertdialog"
    aria-label={`Delete ${title}?`}
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      padding: 'var(--space-3)',
      background: 'oklch(63% 0.258 29 / 0.10)',
      border: '1px solid oklch(63% 0.258 29 / 0.30)',
      borderRadius: 'var(--radius-md)',
    }}
  >
    <div
      style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color: 'var(--color-text-primary)',
      }}
    >
      Delete{' '}
      <span style={{ color: 'var(--color-accent)' }}>{title}</span>?
    </div>
    <div
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      This permanently removes the playlist from your YouTube Music account.
    </div>
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        justifyContent: 'flex-end',
        marginTop: 'var(--space-1)',
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        style={{
          padding: 'var(--space-1) var(--space-3)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          background: 'transparent',
          border: 'none',
          color: 'var(--color-text-secondary)',
          cursor: pending ? 'wait' : 'pointer',
          borderRadius: 'var(--radius-full)',
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          padding: 'var(--space-1) var(--space-4)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          background: 'var(--color-accent)',
          color: 'white',
          border: 'none',
          cursor: pending ? 'wait' : 'pointer',
          borderRadius: 'var(--radius-full)',
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending && (
          <Loader2
            size={14}
            style={{ animation: 'vibeytm-spin 0.9s linear infinite' }}
          />
        )}
        Delete
      </button>
    </div>
  </div>
);

const SkeletonRows: FC = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
    {Array.from({ length: 5 }).map((_, i) => (
      <div
        key={i}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-3)',
          opacity: 0.6,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-3)',
          }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              width: '60%',
              height: 12,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-3)',
              marginBottom: 4,
            }}
          />
          <div
            style={{
              width: '40%',
              height: 10,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-3)',
            }}
          />
        </div>
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Create view
// ---------------------------------------------------------------------------
interface CreateViewProps {
  name: string;
  onNameChange: (s: string) => void;
  privacy: PlaylistPrivacy;
  onPrivacyChange: (p: PlaylistPrivacy) => void;
  pending: boolean;
  onCancel: () => void;
  onCreate: () => void;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
}

const CreateView: FC<CreateViewProps> = ({
  name,
  onNameChange,
  privacy,
  onPrivacyChange,
  pending,
  onCancel,
  onCreate,
  nameInputRef,
}) => {
  const canSubmit = name.trim().length > 0 && !pending;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onCreate();
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        paddingTop: 'var(--space-3)',
      }}
    >
      <div>
        <label
          htmlFor="add-to-playlist-name"
          style={{
            display: 'block',
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 'var(--space-2)',
          }}
        >
          Name *
        </label>
        <input
          ref={nameInputRef}
          id="add-to-playlist-name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={pending}
          maxLength={150}
          style={{
            width: '100%',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-sm)',
            background: 'var(--glass-tile-bg)',
            boxShadow: 'var(--glass-tile-shadow-rest)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            outline: 'none',
          }}
        />
      </div>

      <div>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 'var(--space-2)',
          }}
        >
          Privacy
        </div>
        <div
          role="radiogroup"
          aria-label="Playlist privacy"
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
          }}
        >
          {(['PRIVATE', 'UNLISTED', 'PUBLIC'] as const).map((p) => (
            <PrivacyOption
              key={p}
              value={p}
              checked={privacy === p}
              onChange={() => onPrivacyChange(p)}
              disabled={pending}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          justifyContent: 'flex-end',
          paddingTop: 'var(--space-2)',
          borderTop: '1px solid var(--glass-rim-dim)',
          marginTop: 'var(--space-2)',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: pending ? 'wait' : 'pointer',
            borderRadius: 'var(--radius-full)',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: 'var(--space-2) var(--space-5)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            background: canSubmit
              ? 'var(--color-accent)'
              : 'var(--color-surface-3)',
            color: canSubmit ? 'white' : 'var(--color-text-tertiary)',
            border: 'none',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            borderRadius: 'var(--radius-full)',
            transition:
              'background var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out)',
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending && (
            <Loader2
              size={14}
              style={{ animation: 'vibeytm-spin 0.9s linear infinite' }}
            />
          )}
          Create
        </button>
      </div>
    </form>
  );
};

const PRIVACY_LABELS: Record<PlaylistPrivacy, string> = {
  PRIVATE: 'Private',
  UNLISTED: 'Unlisted',
  PUBLIC: 'Public',
};

const PrivacyOption: FC<{
  value: PlaylistPrivacy;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}> = ({ value, checked, onChange, disabled }) => (
  <label
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      cursor: disabled ? 'wait' : 'pointer',
      fontSize: 'var(--text-sm)',
      color: checked
        ? 'var(--color-text-primary)'
        : 'var(--color-text-secondary)',
    }}
  >
    {/* Custom radio disc — system default rendering doesn't match the
        glass aesthetic, and it's a 14×14 square with a 6×6 inner accent
        ring when selected. */}
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: 'transparent',
        border: checked
          ? '2px solid var(--color-accent)'
          : '1.5px solid var(--color-border)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'border-color var(--duration-fast) var(--ease-out)',
      }}
    >
      {checked && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-accent)',
          }}
        />
      )}
    </span>
    <input
      type="radio"
      value={value}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      style={{
        // Visually hidden but keyboard- and a11y-accessible.
        position: 'absolute',
        opacity: 0,
        width: 0,
        height: 0,
      }}
    />
    {PRIVACY_LABELS[value]}
  </label>
);

// ---------------------------------------------------------------------------
// Error banner + signed-out notice
// ---------------------------------------------------------------------------
const ErrorBanner: FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <button
    type="button"
    onClick={onRetry}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-3)',
      width: '100%',
      background: 'oklch(63% 0.258 29 / 0.10)',
      border: 'none',
      borderRadius: 'var(--radius-md)',
      color: 'var(--color-accent)',
      fontSize: 'var(--text-sm)',
      cursor: 'pointer',
      textAlign: 'left',
      marginBottom: 'var(--space-2)',
    }}
  >
    <AlertCircle size={14} />
    <span style={{ flex: 1 }}>{message}</span>
    <span style={{ fontSize: 'var(--text-xs)', opacity: 0.85 }}>Retry</span>
  </button>
);

const SignedOutNotice: FC = () => (
  <div
    style={{
      paddingTop: 'var(--space-4)',
      paddingBottom: 'var(--space-3)',
      textAlign: 'center',
    }}
  >
    <div
      style={{
        fontSize: 'var(--text-base)',
        fontWeight: 500,
        color: 'var(--color-text-primary)',
        marginBottom: 'var(--space-2)',
      }}
    >
      Sign in to save tracks
    </div>
    <div
      style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      Saving to playlists requires a YouTube Music account.
    </div>
  </div>
);
