import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerState, PlaybackStatus, RepeatMode, TrackInfo } from '../lib/types';
import { bootstrapActivePlaylistFromState, playerApi } from '../lib/ipc';
import { EVENTS } from '../lib/events';
import { useTauriEvent } from './useTauriEvent';
import { decideSeekEvent } from './seekFilter';
import { debug } from '../lib/debug';

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
// actually moved) or this hard-cap fires.
//
// Hard-cap raised from 800 ms to 5 s because a heavy seek (audio buffer
// refill, network stall) routinely takes 1.5–3 s to land its first near-
// target position, and the previous window let the lyric panel snap back
// to the OLD time — `useSmoothedPosition` treats a downward jump as a
// track change and re-bases there, scrolling the lyric panel to the wrong
// line for several seconds until the next fresh position arrives.
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

export interface UsePlayerState extends PlayerState {
  /**
   * Apply a local optimistic patch (e.g. flip status to "playing" on click)
   * so the UI updates instantly. The next backend event overwrites it.
   */
  applyOptimistic: (patch: Partial<PlayerState>) => void;
  /**
   * Record a user-initiated seek target. Lets the POSITION_UPDATED handler
   * discard stale pre-seek echoes that would otherwise bounce the thumb.
   */
  markSeek: (target: number) => void;
}

// Seek-state tracking is HOISTED OUT OF the hook so every `usePlayerState`
// caller — NowPlayingCard (the slider) and NowPlaying (the lyrics
// overlay) — shares the same filter state. A `useRef` inside the hook
// gives each call its own independent ref, which means `markSeek()` from
// the slider doesn't gate the POSITION_UPDATED handler running in the
// lyrics overlay's instance. The result was a stale near-zero echo from
// the bridge slipping through into the overlay's state, snapping the
// smoothed position backward, and resetting the lyric cursor to the
// beginning of the song after every progress-bar click.
//
// These are effectively singletons — only one user interaction is live
// at a time — so module scope is the right scope.
let lastSeekAtGlobal = 0;
let seekTargetGlobal = 0;
let seekPendingGlobal = false;

export function usePlayerState(): UsePlayerState {
  const [state, setState] = useState<PlayerState>(DEFAULT_STATE);
  const lastLocalVolumeAtRef = useRef(0);
  const lastTrackChangeAtRef = useRef(0);
  // Latest status mirror so event handlers can branch on it without
  // rebinding every render. Kept in sync with state.status below.
  const statusRef = useRef<PlaybackStatus>(DEFAULT_STATE.status);
  statusRef.current = state.status;

  useEffect(() => {
    playerApi.getState().then((s) => {
      setState(s);
      // Sync the module-level activePlaylistId from the restored session so
      // QueuePanel's effect (which depends on it) sees the right context
      // immediately after a cold start.
      bootstrapActivePlaylistFromState(s);
    }).catch(() => {
      // Backend not ready yet — keep defaults
    });
  }, []);

  useTauriEvent<TrackInfo>(EVENTS.TRACK_CHANGED, (track) => {
    debug.log('usePlayerState', 'TRACK_CHANGED', {
      videoId: track?.videoId,
      title: track?.title?.slice(0, 40),
    });
    // Reset position alongside the track swap. The bridge emits TRACK_CHANGED
    // and POSITION_UPDATED from separate cycles, so without this the progress
    // bar briefly renders with the old position over the new (shorter)
    // duration — which pins it visually at 100%.
    // EXCEPT when the videoId hasn't actually changed (metadata refinement
    // OR session-restore: persistence::apply seeded a saved track + saved
    // position, then the bridge re-emits the same videoId from YTM's
    // restored session — that re-emit must NOT clobber the saved offset).
    setState((prev) => {
      const isSameTrack =
        !!prev.track && !!track && prev.track.videoId === track.videoId;
      // Only mark the track-change reconcile window when the videoId
      // actually changed. The bridge poller fires `player:track-changed`
      // ALSO on metadata refinement (duration grew, title/artist/artwork
      // updated) — see `webview_bridge/poller.rs` near the
      // `needs_update` block. Updating `lastTrackChangeAtRef` for those
      // emits would arm the >5s POSITION_UPDATED drop filter and discard
      // every legitimate post-seek position event for 1.5s, leaving the
      // lyric panel stuck at the pre-seek time.
      if (!isSameTrack) {
        lastTrackChangeAtRef.current = Date.now();
      }
      return {
        ...prev,
        track,
        positionSecs: isSameTrack ? prev.positionSecs : 0,
      };
    });
  });

  useTauriEvent<PlaybackStatus>(EVENTS.STATUS_CHANGED, (status) => {
    // Suppress stale "paused" echoes right after a seek: YTM briefly
    // reports paused while the video element reseats the buffer, and the
    // play button would flicker to paused before the next "playing" event
    // caught up (issue #41). Drop paused events inside the echo window
    // while we still believe we're playing OR buffering — the intermediate
    // `buffering` status also arrives during a seek and would otherwise let
    // the stale paused through.
    if (
      status === 'paused' &&
      (statusRef.current === 'playing' || statusRef.current === 'buffering') &&
      Date.now() - lastSeekAtGlobal < SEEK_STATUS_ECHO_WINDOW_MS
    ) {
      return;
    }
    setState((prev) => ({ ...prev, status }));
  });

  useTauriEvent<number>(EVENTS.POSITION_UPDATED, (positionSecs) => {
    const now = Date.now();
    // Reject pre-seek stragglers via the pure helper so the rule is
    // unit-testable without booting the Tauri event runtime — see
    // `seekFilter.ts` for the rationale and the test suite for the
    // invariants this defends.
    {
      const decision = decideSeekEvent(
        {
          pending: seekPendingGlobal,
          lastSeekAt: lastSeekAtGlobal,
          target: seekTargetGlobal,
        },
        positionSecs,
        now,
        SEEK_TOLERANCE_SECS,
        SEEK_RECONCILE_WINDOW_MS,
      );
      if (decision.action === 'drop') {
        return;
      }
      seekPendingGlobal = decision.nextPending;
    }
    // Reject old-track stragglers: right after TRACK_CHANGED, the bridge
    // poller may still be reporting the PREVIOUS track's elapsed time
    // until its next cycle settles on the new src. Two filters:
    //
    //   1. Drop positions exceeding the new track's duration (clearly
    //      from the previous track if it was longer).
    //   2. Drop ANY position > FRESH_TRACK_MAX_POSITION_SECS within the
    //      reconcile window. A genuinely fresh track can't have
    //      advanced more than a few seconds; anything bigger is the
    //      previous track's leftover timestamp leaking through. The
    //      progress bar stays at 0 (set by TRACK_CHANGED handler)
    //      until a real, in-range position arrives.
    if (now - lastTrackChangeAtRef.current < TRACK_CHANGE_RECONCILE_WINDOW_MS) {
      if (positionSecs > FRESH_TRACK_MAX_POSITION_SECS) {
        return;
      }
      setState((prev) => {
        const duration = prev.track?.durationSecs ?? 0;
        if (duration > 0 && positionSecs > duration) {
          return prev;
        }
        return { ...prev, positionSecs };
      });
      return;
    }
    setState((prev) => ({ ...prev, positionSecs }));
  });

  useTauriEvent<number>(EVENTS.VOLUME_CHANGED, (volume) => {
    // During a local drag, the bridge poller can emit intermediate values
    // from before the latest set_volume took effect. Those echoes would
    // overwrite the fresh optimistic state and the thumb would jitter.
    if (Date.now() - lastLocalVolumeAtRef.current < VOLUME_ECHO_WINDOW_MS) {
      return;
    }
    setState((prev) => ({ ...prev, volume }));
  });

  useTauriEvent<PlayerState>(EVENTS.PLAYER_STATE_CHANGED, (newState) => {
    setState(newState);
  });

  useTauriEvent<boolean>(EVENTS.SHUFFLE_CHANGED, (isShuffled) => {
    setState((prev) => ({ ...prev, isShuffled }));
  });

  useTauriEvent<RepeatMode>(EVENTS.REPEAT_CHANGED, (repeatMode) => {
    setState((prev) => ({ ...prev, repeatMode }));
  });

  useTauriEvent<boolean>(EVENTS.LIKE_CHANGED, (isLiked) => {
    setState((prev) => ({ ...prev, isLiked }));
  });

  useTauriEvent<TrackInfo[]>(EVENTS.QUEUE_CHANGED, (queue) => {
    setState((prev) => ({ ...prev, queue }));
  });

  // When the user signs out of YouTube Music, the player controller bar
  // still shows the last track's metadata until the page is reloaded
  // (issue #37). Reset the entire player slice to defaults so the sidebar
  // and bottom bar return to their idle state. Account info is handled
  // separately via useAccountInfo.
  useTauriEvent<boolean>(EVENTS.LOGIN_CHANGED, (loggedIn) => {
    if (!loggedIn) {
      setState(DEFAULT_STATE);
    }
  });

  const applyOptimistic = useCallback((patch: Partial<PlayerState>) => {
    if (patch.volume !== undefined) {
      lastLocalVolumeAtRef.current = Date.now();
    }
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const markSeek = useCallback((target: number) => {
    // Module-scope so EVERY usePlayerState consumer (NowPlayingCard +
    // NowPlaying overlay) sees the pending flag, not just the one whose
    // slider fired the click. See the comment on `seekPendingGlobal` at
    // the top of this file for the bug this prevents.
    lastSeekAtGlobal = Date.now();
    seekTargetGlobal = target;
    seekPendingGlobal = true;
  }, []);

  return { ...state, applyOptimistic, markSeek };
}
