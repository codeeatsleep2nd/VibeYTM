import { type FC, useEffect, useState } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import {
  browseApi,
  getActivePlaylistId,
  playerApi,
  subscribeActivePlaylist,
} from '../../lib/ipc';
import type { TrackInfo } from '../../lib/types';
import { CachedImage } from '../CachedImage';

interface QueuePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const UPCOMING_LIMIT = 100;

// Module-level cache keyed by `<videoId>|<playlistId>` so reopening the panel
// for a (track, playlist) pair we've already fetched is instant.
const queueCache = new Map<string, TrackInfo[]>();
const cacheKey = (videoId: string | undefined, playlistId: string | null): string =>
  `${videoId ?? ''}|${playlistId ?? ''}`;

function artwork(track: { artworkUrl?: string | null; videoId?: string }): string | undefined {
  if (track.artworkUrl) return track.artworkUrl;
  if (track.videoId) return `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
  return undefined;
}

/**
 * Playing-queue drawer. Primary source is YTM's DOM queue, pushed by the
 * bridge observer — this reflects the real next/prev order including
 * shuffle. When the observer hasn't populated the state yet (cold open,
 * transient DOM state), falls back to the /next HTTP endpoint so the
 * panel is never empty.
 */
export const QueuePanel: FC<QueuePanelProps> = ({ isOpen, onClose }) => {
  const { track, queue: liveQueue } = usePlayerState();
  const [fetchedUpcoming, setFetchedUpcoming] = useState<TrackInfo[]>([]);
  // Overlaid on top of PlayerState.track while YTM is still navigating to a
  // clicked queue row. Gives instant "now playing" feedback so the panel
  // doesn't look frozen during the YTM round-trip.
  const [pendingCurrent, setPendingCurrent] = useState<TrackInfo | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const currentVideoId = track?.videoId;

  // Mirror the module-level activePlaylistId into React state so effects can
  // depend on it. Without this, clicking Play-All on a list whose first
  // track is already playing wouldn't trigger a re-fetch (currentVideoId
  // unchanged), and the queue would keep showing the previous result.
  const [activePlaylist, setActivePlaylist] = useState<string | null>(() =>
    getActivePlaylistId(),
  );
  useEffect(() => subscribeActivePlaylist(setActivePlaylist), []);

  useEffect(() => {
    if (pendingCurrent && currentVideoId === pendingCurrent.videoId) {
      setPendingCurrent(null);
    }
  }, [currentVideoId, pendingCurrent]);

  // Fetch on EVERY change to track OR active playlist — not gated on isOpen
  // — so when the user clicks prev/next on the player bar OR clicks Play-All
  // on a list, the new queue is fetched in the background. By the time the
  // user opens the queue drawer, the data is already in the module-level
  // cache and rendering is instant.
  //
  // Empty-result fallback policy: only fall back to YTM's default Song
  // Radio (`RDAMVM<videoId>`) when the user is NOT playing from a chosen
  // playlist — i.e. activePlaylist is null OR is itself the song-radio.
  // When the user explicitly picked a playlist (album OLAK, real PL,
  // RDCLAK radio, LM, etc.), an empty /next response is honored — we do
  // not silently swap to the radio behind their back.
  useEffect(() => {
    if (!currentVideoId) return;
    const songRadio = `RDAMVM${currentVideoId}`;
    const isDefaultContext =
      activePlaylist === null || activePlaylist === songRadio;
    const key = cacheKey(currentVideoId, activePlaylist);
    const cached = queueCache.get(key);
    if (cached && cached.length > 0) {
      setFetchedUpcoming(cached);
      setIsFetching(false);
      return;
    }
    // Stale list from the previous track/playlist shouldn't keep rendering
    // during the in-flight fetch, even if the panel happens to be open.
    setFetchedUpcoming([]);
    let cancelled = false;
    setIsFetching(true);

    const fetchWith = (pl: string | null) =>
      browseApi.getUpcomingTracks(currentVideoId, UPCOMING_LIMIT, pl);

    const finish = (tracks: TrackInfo[]) => {
      queueCache.set(key, tracks);
      if (cancelled) return;
      setFetchedUpcoming(tracks);
      setIsFetching(false);
    };

    fetchWith(activePlaylist)
      .then((primary) => {
        if (cancelled) return;
        // From a chosen playlist → respect the result, even if empty.
        if (!isDefaultContext) {
          finish(primary);
          return;
        }
        // Default context → if empty, retry the song-radio explicitly.
        // (No-op when activePlaylist already is the song-radio: that fetch
        //  WAS the radio.)
        if (primary.length > 0 || activePlaylist === songRadio) {
          finish(primary);
          return;
        }
        fetchWith(songRadio)
          .then((radio) => {
            if (cancelled) return;
            finish(radio);
          })
          .catch(() => {
            if (cancelled) return;
            finish(primary);
          });
      })
      .catch(() => {
        if (cancelled) return;
        // Errors from a chosen playlist surface as empty — don't override.
        if (!isDefaultContext) {
          setIsFetching(false);
          return;
        }
        if (activePlaylist === songRadio) {
          setIsFetching(false);
          return;
        }
        fetchWith(songRadio)
          .then((radio) => {
            if (cancelled) return;
            finish(radio);
          })
          .catch(() => {
            if (cancelled) return;
            setIsFetching(false);
          });
      });

    return () => {
      cancelled = true;
    };
  }, [currentVideoId, activePlaylist]);

  useEffect(() => {
    if (!isOpen) setPendingCurrent(null);
  }, [isOpen]);

  const displayTrack = pendingCurrent ?? track;

  // Prefer YTM's DOM queue when available — it reflects the actual next/prev
  // order (including shuffle). Slice after the current track. Fall back to
  // the /next-fetched list when the DOM queue hasn't populated yet.
  let upcoming: TrackInfo[];
  if (displayTrack?.videoId && liveQueue.length > 0) {
    const idx = liveQueue.findIndex((t) => t.videoId === displayTrack.videoId);
    upcoming =
      idx >= 0
        ? liveQueue.slice(idx + 1)
        : liveQueue.filter((t) => t.videoId !== displayTrack.videoId);
  } else {
    upcoming = displayTrack?.videoId
      ? fetchedUpcoming.filter((t) => t.videoId !== displayTrack.videoId)
      : fetchedUpcoming;
  }

  const handleRowClick = (t: TrackInfo) => {
    if (!t.videoId) return;
    setPendingCurrent(t);
    const pl = getActivePlaylistId() ?? undefined;
    playerApi.playTrack(t.videoId, pl).catch(() => {
      setPendingCurrent(null);
    });
  };

  return (
    <aside
      aria-hidden={!isOpen}
      style={{
        position: 'fixed',
        top: 'calc(var(--title-bar-height) + var(--space-3))',
        right: 0,
        bottom: 'var(--player-bar-height)',
        left: 'calc(var(--sidebar-width) + var(--space-6) + min(800px, calc((2 / 3) * (100vw - var(--sidebar-width) - var(--space-6) * 2)), calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) - var(--space-6) - 160px)) + var(--space-5))',
        background: 'var(--color-bg)',
        boxShadow: isOpen ? '-8px 0 24px oklch(0% 0 0 / 0.35)' : 'none',
        zIndex: 90,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        pointerEvents: isOpen ? 'auto' : 'none',
        willChange: 'transform',
        transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        paddingTop: 0,
        paddingLeft: 0,
        paddingRight: 'var(--space-6)',
        paddingBottom: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid oklch(100% 0 0 / 0.06)',
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--color-text-primary)',
          }}
        >
          Playing queue
        </h2>
        <button
          onClick={onClose}
          aria-label="Close queue"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-lg)',
            cursor: 'pointer',
            padding: 'var(--space-1) var(--space-2)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {'×'}
        </button>
      </header>

      <div
        style={{
          overflowY: 'auto',
          paddingTop: 'var(--space-3)',
          flex: 1,
        }}
      >
        {displayTrack && (
          <section style={{ marginBottom: 'var(--space-3)' }}>
            <SectionHeading>Now playing</SectionHeading>
            <QueueRow track={displayTrack} highlighted />
          </section>
        )}

        <section>
          <SectionHeading>Up next</SectionHeading>
          {upcoming.length === 0 && isFetching && <Placeholder text="Loading…" />}
          {upcoming.length === 0 && !isFetching && (
            <Placeholder
              text={displayTrack ? 'Nothing queued next' : 'No track playing'}
            />
          )}
          {upcoming.map((t, i) => (
            <QueueRow
              key={t.videoId || `up-${i}`}
              track={t}
              onPlay={() => handleRowClick(t)}
            />
          ))}
        </section>
      </div>
    </aside>
  );
};

const SectionHeading: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: 'var(--color-text-tertiary)',
      padding: 'var(--space-2) var(--space-3) var(--space-1)',
    }}
  >
    {children}
  </div>
);

const Placeholder: FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      padding: 'var(--space-4) var(--space-3)',
      fontSize: 'var(--text-sm)',
      color: 'var(--color-text-tertiary)',
      textAlign: 'center',
    }}
  >
    {text}
  </div>
);

interface QueueRowProps {
  track: TrackInfo;
  highlighted?: boolean;
  onPlay?: () => void;
}

const QueueRow: FC<QueueRowProps> = ({ track, highlighted = false, onPlay }) => {
  const interactive = Boolean(onPlay) && !highlighted;

  const content = (
    <>
      <div
        style={{
          width: '40px',
          height: '40px',
          flexShrink: 0,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface-3)',
          overflow: 'hidden',
        }}
      >
        <CachedImage
          src={artwork(track)}
          alt={track.title ? `${track.title} artwork` : ''}
          width={40}
          height={40}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: highlighted ? 600 : 500,
            color: highlighted
              ? 'var(--color-accent)'
              : 'var(--color-text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {track.title || 'Unknown title'}
        </div>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {track.artist || ''}
        </div>
      </div>
    </>
  );

  const baseStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    width: '100%',
    background: highlighted ? 'var(--color-surface-2)' : 'transparent',
    border: 'none',
    color: 'inherit',
    textAlign: 'left' as const,
    cursor: interactive ? 'pointer' : 'default',
    transition: `background var(--duration-fast) var(--ease-out)`,
  };

  if (!interactive) {
    return <div style={baseStyle}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onPlay}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-surface-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      style={baseStyle}
    >
      {content}
    </button>
  );
};
