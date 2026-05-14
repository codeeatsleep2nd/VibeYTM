// Single shared player-state store.
//
// Replaces the previous per-component `usePlayerState` hook, where every
// caller created its OWN `useState` + its OWN set of 10 Tauri event
// listeners. `QueueArtwork` calls the player hook once PER QUEUE ROW
// (~100 rows, kept mounted by `SafeOverlay` even when the panel is
// closed), so the old design fanned every `player:position` tick out to
// ~100 `setState` calls → ~100 WKWebView re-renders → the JS thread
// saturated → the Rust poller's main-thread `evaluateJavaScript` calls
// starved → position sampling collapsed from ~6.7 Hz to ~1 Hz. The
// irregular, late samples made `useSmoothedPosition` snap backward
// (it reads any downward jump as a seek), which is the progress-bar
// flicker and the desynced lyric highlight.
//
// This module owns ONE copy of the state and ONE set of listeners.
// Components subscribe via `useSyncExternalStore` (see
// `hooks/usePlayerState.ts`): full-state consumers re-render on any
// change, selector consumers (e.g. `QueueArtwork` reading only
// `activePlaylistId`) re-render only when their slice changes.

import type { PlayerState, PlaybackStatus, RepeatMode, TrackInfo } from './types';
import { bootstrapActivePlaylistFromState, playerApi } from './ipc';
import { EVENTS } from './events';
import { decideSeekEvent } from '../hooks/seekFilter';
import { debug } from './debug';
import { listen } from '@tauri-apps/api/event';

// Drop VOLUME_CHANGED echoes that arrive within this window of a local
// optimistic set, so fast drags (and click-to-jump) aren't overwritten by
// stale intermediate values from the YTM bridge poller. The bridge polls at
// 150ms and YTM's <video>.volume can take up to 3 poll cycles to settle, so
// 1200ms absorbs the whole settling window.
const VOLUME_ECHO_WINDOW_MS = 1200;

// After a seek, ignore STATUS_CHANGED=paused events for this long — they
// are usually stale echoes from before YTM resumed (issue #41).
const SEEK_STATUS_ECHO_WINDOW_MS = 800;

// After a manual seek, POSITION_UPDATED events emitted before YTM finished
// seeking carry pre-seek timestamps that would visually bounce the thumb
// back to the old position. Drop those that are far from the seek target
// until we either see a position near the target (which means YTM has
// actually moved) or this hard-cap fires. See `seekFilter.ts`.
const SEEK_RECONCILE_WINDOW_MS = 5000;
const SEEK_TOLERANCE_SECS = 2;

// After a track change, the bridge poller can still emit one or two
// POSITION_UPDATED events from the OLD track. If the new track is shorter
// than the old position, the clamp in PlayerBar pins the thumb at 100%
// for a frame before normal updates arrive. Drop those stragglers.
const TRACK_CHANGE_RECONCILE_WINDOW_MS = 1500;
// Within the reconcile window, any reported position larger than this
// is treated as a leftover timestamp from the previous track and
// dropped. A genuinely fresh track can't have advanced more than a
// few seconds since the navigation completed.
const FRESH_TRACK_MAX_POSITION_SECS = 5;

const DEFAULT_STATE: PlayerState = {
  status: 'idle',
  track: null,
  positionSecs: 0,
  volume: 1.0,
  isLiked: false,
  repeatMode: 'none',
  isShuffled: false,
  queue: [],
  account: null,
};

// --- Store internals ---------------------------------------------------

let state: PlayerState = DEFAULT_STATE;
const listeners = new Set<() => void>();

// Seek / echo bookkeeping. These were already module-scoped in the old
// hook (seek state) or per-instance refs that were conceptually global
// (only one user interaction is live at a time, and there is now exactly
// one store). Module scope is the correct scope for all of them.
let lastSeekAt = 0;
let seekTarget = 0;
let seekPending = false;
let lastLocalVolumeAt = 0;
let lastTrackChangeAt = 0;
// videoId for which we last re-pulled `activePlaylistId` from Rust —
// dedups the re-pull so it fires once per real track change, not on
// every state mutation.
let lastRepulledVideoId: string | undefined;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Apply an updater. Re-notifies subscribers only when the updater
 *  actually produced a new state reference — handlers that return `prev`
 *  unchanged cost nothing. */
function setState(updater: (prev: PlayerState) => PlayerState): void {
  const next = updater(state);
  if (next === state) return;
  state = next;
  notify();
  maybeRepullActivePlaylist();
}

/** Re-pull `activePlaylistId` from Rust whenever the videoId actually
 *  changes. Rust's `play_track` writes the new context (e.g. `MPSP…` for
 *  a podcast episode) but doesn't emit a dedicated state-change event, so
 *  surfaces gated on it (e.g. the lyrics button's podcast disable) would
 *  otherwise never flip. Deduped on videoId so it fires once per real
 *  track change; the recursive `setState` it triggers is a no-op on the
 *  second pass because the videoId hasn't changed. */
function maybeRepullActivePlaylist(): void {
  const vid = state.track?.videoId;
  if (!vid || vid === lastRepulledVideoId) return;
  lastRepulledVideoId = vid;
  playerApi
    .getState()
    .then((s) => {
      setState((prev) =>
        prev.activePlaylistId === s.activePlaylistId
          ? prev
          : { ...prev, activePlaylistId: s.activePlaylistId },
      );
    })
    .catch(() => {});
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): PlayerState {
  return state;
}

// --- Mutations exposed to components ----------------------------------

/** Apply a local optimistic patch (e.g. flip status to "playing" on
 *  click) so the UI updates instantly. The next backend event overwrites
 *  it. Stable reference — safe to pass straight through render. */
export function applyOptimistic(patch: Partial<PlayerState>): void {
  if (patch.volume !== undefined) {
    lastLocalVolumeAt = Date.now();
  }
  setState((prev) => ({ ...prev, ...patch }));
}

/** Record a user-initiated seek target. Lets the POSITION_UPDATED handler
 *  discard stale pre-seek echoes that would otherwise bounce the thumb. */
export function markSeek(target: number): void {
  lastSeekAt = Date.now();
  seekTarget = target;
  seekPending = true;
}

// --- Event wiring ------------------------------------------------------

let initialized = false;

/** Wire the 10 Tauri player events to the single store and pull the
 *  initial snapshot. Called once at module load; the `initialized` guard
 *  keeps a Vite HMR re-evaluation from double-subscribing. */
function initStore(): void {
  if (initialized) return;
  initialized = true;

  // Initial snapshot — restored session or cold defaults.
  playerApi
    .getState()
    .then((s) => {
      setState(() => s);
      bootstrapActivePlaylistFromState(s);
    })
    .catch(() => {
      // Backend not ready yet — keep defaults.
    });

  const on = <T>(eventName: string, handler: (payload: T) => void): void => {
    listen<T>(eventName, (event) => handler(event.payload)).catch(() => {
      // Not running inside Tauri (e.g. unit tests) — ignore.
    });
  };

  on<TrackInfo>(EVENTS.TRACK_CHANGED, (track) => {
    debug.log('playerStore', 'TRACK_CHANGED', {
      videoId: track?.videoId,
      title: track?.title?.slice(0, 40),
    });
    // Reset position alongside the track swap. The bridge emits
    // TRACK_CHANGED and POSITION_UPDATED from separate cycles, so without
    // this the progress bar briefly renders with the old position over
    // the new (shorter) duration — which pins it visually at 100%.
    // EXCEPT when the videoId hasn't actually changed (metadata
    // refinement OR session-restore re-emit) — that must NOT clobber the
    // saved offset.
    setState((prev) => {
      const isSameTrack =
        !!prev.track && !!track && prev.track.videoId === track.videoId;
      // Only arm the track-change reconcile window when the videoId
      // actually changed. The bridge poller fires `player:track-changed`
      // ALSO on metadata refinement (duration grew, title/artist/artwork
      // updated). Updating `lastTrackChangeAt` for those emits would arm
      // the >5s POSITION_UPDATED drop filter and discard every legitimate
      // post-seek position event for 1.5s, leaving the lyric panel stuck
      // at the pre-seek time.
      if (!isSameTrack) {
        lastTrackChangeAt = Date.now();
      }
      return {
        ...prev,
        track,
        positionSecs: isSameTrack ? prev.positionSecs : 0,
      };
    });
  });

  on<PlaybackStatus>(EVENTS.STATUS_CHANGED, (status) => {
    // Suppress stale "paused" echoes right after a seek: YTM briefly
    // reports paused while the video element reseats the buffer, and the
    // play button would flicker to paused before the next "playing" event
    // caught up (issue #41).
    if (
      status === 'paused' &&
      (state.status === 'playing' || state.status === 'buffering') &&
      Date.now() - lastSeekAt < SEEK_STATUS_ECHO_WINDOW_MS
    ) {
      return;
    }
    setState((prev) => (prev.status === status ? prev : { ...prev, status }));
  });

  on<number>(EVENTS.POSITION_UPDATED, (positionSecs) => {
    const now = Date.now();
    // Reject pre-seek stragglers via the pure helper — see `seekFilter.ts`.
    {
      const decision = decideSeekEvent(
        { pending: seekPending, lastSeekAt, target: seekTarget },
        positionSecs,
        now,
        SEEK_TOLERANCE_SECS,
        SEEK_RECONCILE_WINDOW_MS,
      );
      if (decision.action === 'drop') {
        return;
      }
      seekPending = decision.nextPending;
    }
    // Reject old-track stragglers: right after TRACK_CHANGED, the bridge
    // poller may still be reporting the PREVIOUS track's elapsed time
    // until its next cycle settles on the new src.
    if (now - lastTrackChangeAt < TRACK_CHANGE_RECONCILE_WINDOW_MS) {
      if (positionSecs > FRESH_TRACK_MAX_POSITION_SECS) {
        return;
      }
      setState((prev) => {
        const duration = prev.track?.durationSecs ?? 0;
        if (duration > 0 && positionSecs > duration) {
          return prev;
        }
        if (prev.positionSecs === positionSecs) return prev;
        return { ...prev, positionSecs };
      });
      return;
    }
    // Skip the setState entirely when the value hasn't moved (issue #103).
    setState((prev) =>
      prev.positionSecs === positionSecs ? prev : { ...prev, positionSecs },
    );
  });

  on<number>(EVENTS.VOLUME_CHANGED, (volume) => {
    // During a local drag, the bridge poller can emit intermediate values
    // from before the latest set_volume took effect.
    if (Date.now() - lastLocalVolumeAt < VOLUME_ECHO_WINDOW_MS) {
      return;
    }
    setState((prev) => ({ ...prev, volume }));
  });

  on<PlayerState>(EVENTS.PLAYER_STATE_CHANGED, (newState) => {
    setState(() => newState);
  });

  on<boolean>(EVENTS.SHUFFLE_CHANGED, (isShuffled) => {
    setState((prev) => ({ ...prev, isShuffled }));
  });

  on<RepeatMode>(EVENTS.REPEAT_CHANGED, (repeatMode) => {
    setState((prev) => ({ ...prev, repeatMode }));
  });

  on<boolean>(EVENTS.LIKE_CHANGED, (isLiked) => {
    setState((prev) => ({ ...prev, isLiked }));
  });

  on<TrackInfo[]>(EVENTS.QUEUE_CHANGED, (queue) => {
    setState((prev) => ({ ...prev, queue }));
  });

  // When the user signs out of YouTube Music, reset the entire player
  // slice to defaults so the sidebar and bottom bar return to idle
  // (issue #37). Account info is handled separately via useAccountInfo.
  on<boolean>(EVENTS.LOGIN_CHANGED, (loggedIn) => {
    if (!loggedIn) {
      setState(() => DEFAULT_STATE);
    }
  });
}

initStore();
