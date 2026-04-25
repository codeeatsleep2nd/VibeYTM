import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { useAudioCounterpartArtwork } from '../../hooks/useAudioCounterpartArtwork';
import { ArtworkPlaceholder } from '../ArtworkPlaceholder';
import {
  browseApi,
  getActivePlaylistId,
  getPredictedTrack,
  playerApi,
  setPlannedQueue,
  setPredictedTrack,
  subscribeActivePlaylist,
  subscribePredictedTrack,
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

/**
 * Drop ANY repeat of the same videoId AND any later occurrence of a song
 * sharing a normalized title with one already in the list. YTM's radio
 * frequently sprinkles multiple recordings of the same song (different
 * artists' covers, lyric videos) — distinct videoIds but visually
 * indistinguishable. Keep only the first occurrence per (videoId | title).
 *
 * `seedCurrent` is the currently-playing track. Pre-seeding both its
 * videoId AND normalized title prevents the Up-Next list from opening
 * with a different recording of the same song the user is hearing.
 */
function dedupeByVideoIdAndTitle(
  items: TrackInfo[],
  seedCurrent?: TrackInfo | null,
): TrackInfo[] {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  if (seedCurrent?.videoId) seenIds.add(seedCurrent.videoId);
  const seedTitle = normalizeTitle(seedCurrent?.title);
  if (seedTitle) seenTitles.add(seedTitle);
  const out: TrackInfo[] = [];
  for (const t of items) {
    if (t.videoId && seenIds.has(t.videoId)) continue;
    const titleKey = normalizeTitle(t.title);
    if (titleKey && seenTitles.has(titleKey)) continue;
    if (t.videoId) seenIds.add(t.videoId);
    if (titleKey) seenTitles.add(titleKey);
    out.push(t);
  }
  return out;
}

function normalizeTitle(title: string | undefined): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[「」『』《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build an ordered list of album-art URL fallbacks for a queue row.
 *
 * **The user-facing rule: NEVER fall back to a YouTube video
 * thumbnail (`i.ytimg.com/vi/...`).** The chain only contains album
 * art (`lh*.googleusercontent.com` / `yt3.googleusercontent.com`).
 * If we have nothing, we render `<ArtworkPlaceholder>` (a music-
 * note glyph on a dark gradient) — that reads as "no cover yet"
 * rather than "wrong image."
 */
export { isAlbumArtUrl } from '../../lib/artwork';

// Re-exported here for the existing test suite. Kept narrow on
// purpose: the ONLY URLs we'll ever show are album art.
export function isStableArtworkUrl(url: string | null | undefined): boolean {
  return isAlbumArtUrlImpl(url);
}

import { isAlbumArtUrl as isAlbumArtUrlImpl } from '../../lib/artwork';

export function artworkChain(track: { videoId?: string; artworkUrl?: string | null }): string[] {
  if (isAlbumArtUrlImpl(track.artworkUrl)) {
    return [track.artworkUrl as string];
  }
  return [];
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

    // Defer the /next fetch by 1.5s after a track change. When YTM's
    // audio webview navigates, in-flight fetch() calls hang for the
    // duration (~3-15s). Firing immediately at the moment of
    // navigation stacks calls in the bridge channel and starves
    // user-driven clicks (playlist/album cards via get_playlist),
    // making them feel unresponsive. A short settle window keeps
    // the channel clear for foreground actions.
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
    }, 1500);

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
    if (artworkOverrides.size === 0) return baseRenderQueue;
    return baseRenderQueue.map((row) => {
      if (!row.videoId) return row;
      const better = artworkOverrides.get(row.videoId);
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
    <aside
      ref={panelRef}
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
        ref={scrollContainerRef}
        style={{
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
          <Placeholder text="Loading…" />
        )}
        {upcoming.length === 0 && !isFetching && !displayTrack && (
          <Placeholder text="No track playing" />
        )}
        {upcoming.map((t, i) => (
          <QueueRow
            key={t.videoId || `up-${i}`}
            track={t}
            onPlay={() => handleRowClick(t)}
          />
        ))}
      </div>
    </aside>
  );
};

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
  /** When true, render the animated playing-bars indicator + accent style. */
  nowPlaying?: boolean;
  /** When true, render at lower opacity (history rows). */
  dimmed?: boolean;
  onPlay?: () => void;
  /**
   * Optional live PlayerState track. Forwarded to `QueueArtwork` for
   * the now-playing row so the queue thumbnail matches the player bar's
   * canonical album-art URL even when the queue's own metadata came
   * from a DOM scrape with a signed thumbnail.
   */
  liveTrack?: TrackInfo | null;
}

const QueueRow: FC<QueueRowProps> = ({
  track,
  highlighted = false,
  nowPlaying = false,
  dimmed = false,
  onPlay,
  liveTrack,
}) => {
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
          position: 'relative',
        }}
      >
        <QueueArtwork track={track} liveTrack={liveTrack} />
        {nowPlaying && <PlayingBarsOverlay />}
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
    opacity: dimmed ? 0.55 : 1,
    transition: `background var(--duration-fast) var(--ease-out),
                 opacity var(--duration-fast) var(--ease-out)`,
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
        e.currentTarget.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.opacity = dimmed ? '0.55' : '1';
      }}
      style={baseStyle}
    >
      {content}
    </button>
  );
};

/**
 * Three vertical bars that bounce in sequence — the universal "audio is
 * playing" affordance. Rendered as an overlay on top of the artwork
 * thumbnail of the now-playing row, with a translucent dark scrim so the
 * bars stay legible against any cover art.
 */
const PlayingBarsOverlay: FC = () => (
  <div
    aria-hidden
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: '2px',
      paddingBottom: '6px',
      background: 'oklch(0% 0 0 / 0.45)',
      pointerEvents: 'none',
    }}
  >
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        style={{
          width: '3px',
          height: '60%',
          background: 'var(--color-accent)',
          borderRadius: '1px',
          transformOrigin: 'bottom',
          animation: `vibeytm-bar 900ms ease-in-out ${i * 150}ms infinite`,
        }}
      />
    ))}
  </div>
);

interface QueueArtworkProps {
  track: TrackInfo;
  /**
   * Optional override used by the now-playing row. When the queue's row
   * metadata came from a DOM scrape (signed thumbnail URL filtered out
   * by `artworkChain`), passing the live PlayerState track here lets
   * the row pull the same stable album-art URL the player bar shows,
   * keeping the two surfaces visually consistent.
   */
  liveTrack?: TrackInfo | null;
}

/**
 * Queue thumbnail with a YouTube CDN fallback chain. Routes through
 * `CachedImage` (Rust-side `cache_fetch_image` via reqwest) so the YT
 * CDN URLs sidestep the WKWebView referrer/CORS restrictions that
 * cause plain `<img>` loads of `i.ytimg.com` to silently fail in the
 * Tauri shell.
 *
 * The bridge often captures an empty (or signed/expiring) `artworkUrl`
 * for off-screen YTM queue rows; the chain falls back through the
 * canonical video-thumbnail variants so the row never goes blank.
 */
const QueueArtwork: FC<QueueArtworkProps> = ({ track, liveTrack }) => {
  // Prefer the live PlayerState track's artworkUrl when it's available
  // and matches the queue row's videoId — that's the bar's source and
  // matches the now-playing page exactly. Falls through to the queue
  // row's own track if not provided or mismatched.
  const sourceTrack =
    liveTrack && liveTrack.videoId === track.videoId ? liveTrack : track;
  const chain = artworkChain(sourceTrack);
  const [chainIdx, setChainIdx] = useState(0);
  useEffect(() => {
    setChainIdx(0);
  }, [sourceTrack.videoId, sourceTrack.artworkUrl]);
  const src = chain[chainIdx];
  if (!src) return <ArtworkPlaceholder size={40} />;
  return (
    <CachedImage
      key={src}
      src={src}
      alt={track.title ? `${track.title} artwork` : ''}
      width={40}
      height={40}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onError={(e) => {
        const next = chainIdx + 1;
        if (next < chain.length) {
          setChainIdx(next);
        } else {
          e.currentTarget.style.display = 'none';
        }
      }}
    />
  );
};
