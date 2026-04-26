import {
  type FC,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePlayerState } from '../../../hooks/usePlayerState';
import { useAudioCounterpartArtwork } from '../../../hooks/useAudioCounterpartArtwork';
import {
  lookupTrackArtwork,
  rememberTrackArtworks,
} from '../../../lib/trackArtworkRegistry';
import {
  browseApi,
  getActivePlaylistId,
  getPredictedTrack,
  playerApi,
  setPlannedQueue,
  setPredictedTrack,
  subscribeActivePlaylist,
  subscribePredictedTrack,
} from '../../../lib/ipc';
import type { TrackInfo } from '../../../lib/types';
import { SafeOverlay } from '../../overlay/SafeOverlay';
import { BRIDGE_SETTLE_MS } from '../../../hooks/useBridgeSafeFetch';
import { QueueRow } from './QueueRow';
import { QueuePlaceholder } from './Placeholder';
import { dedupeByVideoIdAndTitle } from './dedup';
import { queueCache, cacheKey, UPCOMING_LIMIT } from './cache';

// Public re-exports for the existing artwork test suite
// (`QueuePanel.artwork.test.ts` imports these from './QueuePanel'). The
// implementations themselves now live in `./artwork.ts`.
export { isAlbumArtUrl, isStableArtworkUrl, artworkChain } from './artwork';

interface QueuePanelProps {
  isOpen: boolean;
  onClose: () => void;
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
  // Audio-counterpart album cover for the live track. Used by the
  // now-playing row inside this panel so it matches the player bar /
  // now-playing page rather than the bridge-captured video frame.
  const liveCounterpartArtwork = useAudioCounterpartArtwork(
    track?.videoId,
    track?.artworkUrl,
  );
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

  // When the active playlist is a real playlist/album (NOT a YTM
  // song-radio `RDAMVM<videoId>`), fetch its full track list ONCE and
  // push every track's lh3 album-art URL into the cross-component
  // registry. The queue rendering then picks up covers for every
  // queued item via `lookupTrackArtwork`, instead of falling through
  // to the i.ytimg DOM-scraped URLs that get filtered as video
  // thumbnails. One YTM call covers the whole queue — far cheaper
  // than per-row counterpart IPCs.
  //
  // De-duped by playlistId via `enrichedPlaylistsRef` so navigating
  // back to the same playlist within a session doesn't re-fetch.
  // Best-effort: failures are silent; the on-demand counterpart
  // hook is the existing fallback.
  const enrichedPlaylistsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activePlaylist) return;
    if (activePlaylist.startsWith('RDAMVM')) return; // song-radio: no playlist entity
    if (enrichedPlaylistsRef.current.has(activePlaylist)) return;
    enrichedPlaylistsRef.current.add(activePlaylist);
    let cancelled = false;
    browseApi
      .getPlaylist(activePlaylist)
      .then((detail) => {
        if (cancelled) return;
        rememberTrackArtworks(detail.tracks);
      })
      .catch(() => {
        // Allow retry on next visit if it failed.
        enrichedPlaylistsRef.current.delete(activePlaylist);
      });
    return () => {
      cancelled = true;
    };
  }, [activePlaylist]);

  // Predicted-track overlay: when PlayerBar's Next/Prev runs, it sets
  // the predicted track synchronously. We mirror it into local state
  // (so React re-renders) and use it as displayTrack until the real
  // `track` from usePlayerState catches up. This lands the playing
  // animation + now-playing row on the next song on the same frame as
  // the click — no IPC / bridge wait.
  const [predicted, setPredicted] = useState<TrackInfo | null>(() =>
    getPredictedTrack(),
  );
  useEffect(() => subscribePredictedTrack(setPredicted), []);

  // YTM regenerates a song-radio's tail each time it advances — same
  // current track + first few entries, but everything past the cursor
  // gets re-rolled with new "suggestions". Mirroring that one-to-one
  // makes the panel's Up Next list churn on every Next click. Instead,
  // freeze the queue per (activePlaylist) and only accept incoming
  // bridge pushes when they EXTEND what we already have (more items
  // appended) — never when they reorder or replace the tail.
  //
  // Reset on activePlaylist change → Play-All / new playlist context
  // gives us a fresh queue; song-radio churn within the same context
  // is suppressed.
  //
  // Race guard: the bridge's queue push for a new context arrives a few
  // poll cycles AFTER activePlaylist flips. If we naively captured the
  // current liveQueue at the moment of the flip, we'd lock in the
  // PREVIOUS context's queue and then reject the real one as
  // "divergent". `staleQueueFpRef` records the fingerprint of liveQueue
  // at the flip; the liveQueue effect waits until liveQueue differs
  // from that fingerprint before capturing.
  const [frozenQueue, setFrozenQueue] = useState<TrackInfo[]>([]);
  const staleQueueFpRef = useRef<string>('');
  useEffect(() => {
    staleQueueFpRef.current = liveQueue.map((t) => t.videoId).join('|');
    setFrozenQueue([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaylist]);

  // When the user clicks Next (or YTM auto-advances), the current track
  // changes. If the new track is already inside our frozen queue, the
  // queue is "still valid" — just advance the cursor; do NOT replace.
  // If the new track ISN'T in the frozen queue (YTM picked something
  // outside, e.g. radio-regenerated tail or jumped to another playlist),
  // the frozen queue is no longer relevant — reset so the next
  // liveQueue push becomes the new baseline.
  useEffect(() => {
    if (!currentVideoId) return;
    if (frozenQueue.length === 0) return;
    const inFrozen = frozenQueue.some((t) => t.videoId === currentVideoId);
    if (inFrozen) return;
    staleQueueFpRef.current = liveQueue.map((t) => t.videoId).join('|');
    setFrozenQueue([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideoId]);
  useEffect(() => {
    if (liveQueue.length === 0) return;
    const fp = liveQueue.map((t) => t.videoId).join('|');
    if (fp === staleQueueFpRef.current) return; // still pre-flip data
    staleQueueFpRef.current = ''; // first fresh push observed; gate is open
    setFrozenQueue((prev) => {
      if (prev.length === 0) return liveQueue;
      // Accept extensions: new is `prev` followed by additional items.
      if (liveQueue.length >= prev.length) {
        let isExtension = true;
        for (let i = 0; i < prev.length; i++) {
          if (liveQueue[i].videoId !== prev[i].videoId) {
            isExtension = false;
            break;
          }
        }
        if (isExtension) return liveQueue;
      }
      // Accept extension after a head-shift: YTM sometimes pops the
      // played-from-front item, so the prev list is suffix-aligned with
      // the new one.
      const shiftIdx = liveQueue.findIndex(
        (t) => prev[0].videoId === t.videoId,
      );
      if (shiftIdx >= 0) {
        const tail = liveQueue.slice(shiftIdx);
        if (tail.length >= prev.length) {
          let suffixMatch = true;
          for (let i = 0; i < prev.length; i++) {
            if (tail[i].videoId !== prev[i].videoId) {
              suffixMatch = false;
              break;
            }
          }
          if (suffixMatch) return tail;
        }
      }
      // Diverged — keep prior, ignore the regeneration.
      return prev;
    });
  }, [liveQueue]);

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
    // Skip the /next HTTP fetch when YTM's DOM queue already has this
    // track in it. The DOM scrape is the source of truth for the panel
    // (liveQueue branch is preferred in render), so refetching every
    // time the user hits Next would be a wasted round-trip — and the
    // brief "setFetchedUpcoming([])" below would make the panel look
    // like it's reloading even though liveQueue was perfectly fine.
    if (liveQueue.some((t) => t.videoId === currentVideoId)) {
      setIsFetching(false);
      return;
    }
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

    // Defer the /next fetch by BRIDGE_SETTLE_MS after a track change.
    // Synchronous stage above (cache check + state staging) runs
    // immediately so the panel paints cached data without delay; only
    // the network round-trip waits for the bridge to settle. See
    // CLAUDE.md "Background fetches need a settle delay after track
    // change" — same constant `BRIDGE_SETTLE_MS` shared with the lyric
    // probe and the chrome's lyric+cover preload.
    const timer = setTimeout(() => {
      if (cancelled) return;
      fetchWith(activePlaylist)
        .then((primary) => {
          if (cancelled) return;
          // From a chosen playlist → respect the result, even if empty.
          if (!isDefaultContext) {
            finish(primary);
            return;
          }
          // Default context → if empty, retry the song-radio explicitly.
          // (No-op when activePlaylist already is the song-radio: that
          //  fetch WAS the radio.)
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
    }, BRIDGE_SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentVideoId, activePlaylist]);

  useEffect(() => {
    if (!isOpen) setPendingCurrent(null);
  }, [isOpen]);

  // Display priority: pending row-click > predicted Next/Prev > real
  // track from PlayerState. The first two are synchronous overlays
  // that land the UI on the user-intended track instantly; both
  // self-clear once the real `track` matches.
  const displayTrack = pendingCurrent ?? predicted ?? track;
  // Auto-clear the predicted overlay once the real track catches up.
  useEffect(() => {
    if (predicted && track && predicted.videoId === track.videoId) {
      setPredictedTrack(null);
    }
  }, [predicted, track]);

  // Render against the FROZEN queue (the bridge's liveQueue is funneled
  // through the freeze policy above). For cold starts where the bridge
  // hasn't populated yet, fall back to the /next-fetched list.
  //
  // Album-art enrichment: the DOM scrape captures whatever `<img src>`
  // YTM happens to render in the queue panel — for music-video tracks
  // that's the i.ytimg.com 16:9 frame, which our `albumArtOrNothing`
  // filter rejects → blank cover. The /next API parse
  // (`fetchedUpcoming`) extracts the audio counterpart's lh3 album
  // art via `pick_audio_renderer`, so for each queue row whose
  // videoId matches an entry in `fetchedUpcoming`, override the
  // artwork URL with the API-sourced one. Also fold in the live
  // PlayerState track's album-art URL when present, so the now-
  // playing row's `liveTrack` override is consistent with the
  // upcoming rows. Net effect: queue rows show the song cover
  // whenever YTM has one, not the music-video frame.
  const baseRenderQueue = frozenQueue.length > 0 ? frozenQueue : liveQueue;
  const artworkOverrides = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of fetchedUpcoming) {
      if (t.videoId && t.artworkUrl) {
        map.set(t.videoId, t.artworkUrl);
      }
    }
    if (track?.videoId && track.artworkUrl) {
      map.set(track.videoId, track.artworkUrl);
    }
    return map;
  }, [fetchedUpcoming, track?.videoId, track?.artworkUrl]);
  const renderQueue = useMemo(() => {
    return baseRenderQueue.map((row) => {
      if (!row.videoId) return row;
      // Tier 1: per-session map populated from /next + live track.
      // Tier 2: cross-component registry (PlaylistDetail / LibraryPage
      //         / etc. populate this on fetch). Lets the queue row
      //         show the same album art the user just saw on the
      //         playlist detail page, even when /next didn't return
      //         it for this row.
      const better =
        artworkOverrides.get(row.videoId) ??
        lookupTrackArtwork(row.videoId);
      if (better && better !== row.artworkUrl) {
        return { ...row, artworkUrl: better };
      }
      return row;
    });
  }, [baseRenderQueue, artworkOverrides]);
  let upcoming: TrackInfo[];
  if (displayTrack?.videoId && renderQueue.length > 0) {
    const idx = renderQueue.findIndex((t) => t.videoId === displayTrack.videoId);
    upcoming =
      idx >= 0
        ? renderQueue.slice(idx + 1)
        : renderQueue.filter((t) => t.videoId !== displayTrack.videoId);
  } else {
    upcoming = displayTrack?.videoId
      ? fetchedUpcoming.filter((t) => t.videoId !== displayTrack.videoId)
      : fetchedUpcoming;
  }
  // Defensive scrub: never let the currently-displayed track appear in
  // "upcoming" (catches DOM duplicates that the scrape-time dedup didn't).
  if (displayTrack?.videoId) {
    const currentId = displayTrack.videoId;
    upcoming = upcoming.filter((t) => t.videoId !== currentId);
  }
  // Collapse same-title-different-recording repeats AND seed the current
  // track's title so the row right after the now-playing entry is never
  // the same song the user is currently hearing.
  upcoming = dedupeByVideoIdAndTitle(upcoming, displayTrack);

  // Build the unified rendered list: history (queue items BEFORE the
  // current track in YTM's DOM order) + current + upcoming. History is
  // only available when liveQueue contains entries before the current
  // index — YTM accumulates already-played items there as the radio
  // advances. Initial scroll anchors current at the top of the visible
  // area so the user defaults to seeing what's coming next; scrolling
  // up reveals history.
  let history: TrackInfo[] = [];
  if (displayTrack?.videoId && renderQueue.length > 0) {
    const idx = renderQueue.findIndex((t) => t.videoId === displayTrack.videoId);
    if (idx > 0) {
      history = renderQueue.slice(0, idx);
      history = dedupeByVideoIdAndTitle(history, displayTrack);
    }
  }

  // Publish what the user can SEE so the Player-Bar Next/Previous buttons
  // navigate the same list. Without this, those buttons fall through to
  // YTM's internal `nextVideo()`/`previousVideo()` whose cursor advances
  // through YTM's *internal* queue — which periodically diverges from
  // our visible queue when the song-radio regenerates, making clicks
  // appear to jump to "random" songs.
  useEffect(() => {
    setPlannedQueue(history, upcoming);
    return () => setPlannedQueue([], []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    history.map((t) => t.videoId).join('|'),
    upcoming.map((t) => t.videoId).join('|'),
  ]);

  // (Lyrics-preload moved off of this effect — it duplicated the
  // PlayerBar's `getUpcomingTracks(currentVideoId, 3)` fan-out and
  // doubled the YTM API concurrency, causing `get_playlist` /
  // `get_upcoming_tracks` calls to time out and making playlist /
  // album cards look unresponsive. The PlayerBar preloader already
  // warms the next ~2 tracks' lyrics from the same source.)

  const handleRowClick = (t: TrackInfo) => {
    if (!t.videoId) return;
    setPendingCurrent(t);
    const pl = getActivePlaylistId() ?? undefined;
    playerApi.playTrack(t.videoId, pl).catch(() => {
      setPendingCurrent(null);
    });
  };

  // Anchor the now-playing row at the top of the scroll container whenever
  // it appears or the current track changes. User can scroll UP to see
  // history (already-played tracks) and DOWN to see upcoming.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const currentRowRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // Track whether this is the first render of the panel session, so the
  // initial open snaps instantly while subsequent track changes within
  // an open panel scroll smoothly.
  const firstScrollRef = useRef(true);
  useEffect(() => {
    if (!isOpen) {
      firstScrollRef.current = true;
      return;
    }
    const el = currentRowRef.current;
    const container = scrollContainerRef.current;
    if (!el || !container) return;
    const targetTop = Math.max(0, el.offsetTop - container.offsetTop);
    if (firstScrollRef.current) {
      container.scrollTop = targetTop;
      firstScrollRef.current = false;
      return;
    }
    // Custom rAF-driven scroll that runs concurrently with the row's
    // flash entrance animation — no hold delay; the user sees motion
    // start instantly on Next click, and the new now-playing row's
    // playing-indicator + accent flash animate while the list scrolls.
    const SCROLL_MS = 520;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const startTop = container.scrollTop;
    const delta = targetTop - startTop;
    if (Math.abs(delta) < 1) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / SCROLL_MS);
      container.scrollTop = startTop + delta * easeOutCubic(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [isOpen, displayTrack?.videoId]);

  // Close the queue when the user clicks anywhere outside it. Mounted only
  // while the panel is open so we don't pay the listener cost when closed.
  // Uses `mousedown` (not `click`) so the close fires before any potential
  // click-handler on the target — feels more responsive.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = e.target as Element | null;
      if (!target) return;
      // Click inside the panel — let its handlers run.
      if (panel.contains(target)) return;
      // Click on a clickable element OUTSIDE the panel — let that
      // element's own handler run; don't close. Covers buttons, links,
      // form fields, range/slider inputs, role=button, focusable items,
      // and anything explicitly tagged `data-clickable="true"`.
      const clickable = target.closest(
        'button, a, [role="button"], input, select, textarea, label, [tabindex], [data-clickable="true"]',
      );
      if (clickable) return;
      // Truly inert area — close.
      onClose();
    };
    // Schedule on the next tick so the click that *opened* the panel
    // doesn't immediately close it (the open click fires before this
    // effect's listener attaches).
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', handler, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handler, true);
    };
  }, [isOpen, onClose]);

  return (
    <SafeOverlay
      ref={panelRef as Ref<HTMLElement>}
      isOpen={isOpen}
      ariaLabel="Playing queue"
      as="aside"
      slideFrom="right"
      zIndex={90}
      // Transparent so the `.liquidGL-pane` child can carry the glass
      // surface (or the WebGL refraction once liquidGL attaches). See
      // the lens div below.
      background="transparent"
      boxShadow={isOpen ? '-8px 0 24px oklch(0% 0 0 / 0.35)' : undefined}
      inset={{
        top: 'calc(var(--title-bar-height) + var(--space-3))',
        right: '0',
        bottom: 'var(--player-bar-height)',
        left: 'calc(var(--sidebar-width) + var(--space-6) + min(800px, calc((2 / 3) * (100vw - var(--sidebar-width) - var(--space-6) * 2)), calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) - 160px)) + var(--space-5))',
      }}
      padding={{ right: 'var(--space-6)' }}
      display="flex"
      flexDirection="column"
    >
      {/*
        liquidGL lens — empty pane sized to the drawer; carries the
        glass styling so the drawer reads as Liquid-Glass even when
        liquidGL hasn't initialised. Positioned absolutely behind the
        contents (zIndex 0) so the WebGL refraction lands at the
        drawer's rect once the lens is promoted. `pointer-events:none`
        keeps clicks live on the queue rows above. See PlayerChrome
        for the same pattern + rationale.
      */}
      <div
        className="liquidGL-pane"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          borderLeft: '1px solid oklch(100% 0 0 / 0.06)',
        }}
      />
      <header
        style={{
          position: 'relative',
          zIndex: 1,
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
          type="button"
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
        ref={scrollContainerRef}
        style={{
          position: 'relative',
          zIndex: 1,
          overflowY: 'auto',
          paddingTop: 'var(--space-3)',
          flex: 1,
        }}
      >
        {/* History (already-played tracks above the current). Visible when
            user scrolls up. */}
        {history.map((t, i) => (
          <QueueRow
            key={`hist-${t.videoId || i}`}
            track={t}
            onPlay={() => handleRowClick(t)}
            dimmed
          />
        ))}

        {/* Now playing row — anchored at the top of the visible area on
            open/track-change. The `key={videoId}` re-mounts this wrapper
            each track change, re-firing the entrance animation as a
            visible cue that the cursor advanced.

            Source-of-data preference: when the new track's videoId is
            already in renderQueue with real metadata, use THAT entry
            instead of displayTrack. Right after Next is clicked the
            `displayTrack` is briefly the Rust-emitted placeholder
            (title="Loading...", empty artist) whose real metadata
            arrives later via the bridge poller — by which point the
            user has already seen the wrong (or empty) title. The
            queue entry has had the real metadata since the moment we
            first scraped this list, so we can render correctly NOW. */}
        {displayTrack && (() => {
          const fromQueue = displayTrack.videoId
            ? renderQueue.find((t) => t.videoId === displayTrack.videoId)
            : undefined;
          const nowPlayingTrack =
            fromQueue && fromQueue.title ? fromQueue : displayTrack;
          return (
            <div
              ref={currentRowRef}
              key={displayTrack.videoId}
              className="vibeytm-queue-current-flash"
            >
              <QueueRow
                track={nowPlayingTrack}
                highlighted
                nowPlaying
                liveTrack={
                  track
                    ? { ...track, artworkUrl: liveCounterpartArtwork ?? track.artworkUrl }
                    : null
                }
              />
            </div>
          );
        })()}

        {/* Upcoming. */}
        {upcoming.length === 0 && isFetching && !displayTrack && (
          <QueuePlaceholder text="Loading…" />
        )}
        {upcoming.length === 0 && !isFetching && !displayTrack && (
          <QueuePlaceholder text="No track playing" />
        )}
        {upcoming.map((t, i) => (
          <QueueRow
            key={t.videoId || `up-${i}`}
            track={t}
            onPlay={() => handleRowClick(t)}
          />
        ))}
      </div>
    </SafeOverlay>
  );
};
