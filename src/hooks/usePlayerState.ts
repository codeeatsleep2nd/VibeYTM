import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerState, PlaybackStatus, RepeatMode, TrackInfo } from '../lib/types';
import { bootstrapActivePlaylistFromState, playerApi } from '../lib/ipc';
import { EVENTS } from '../lib/events';
import { useTauriEvent } from './useTauriEvent';

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
// back to the old position. Drop those within this reconciliation window
// ONLY if they are far from the seek target.
const SEEK_RECONCILE_WINDOW_MS = 800;
const SEEK_TOLERANCE_SECS = 2;

// After a track change, the bridge poller can still emit one or two
// POSITION_UPDATED events from the OLD track. If the new track is shorter
// than the old position, the clamp in PlayerBar pins the thumb at 100%
// for a frame before normal updates arrive. Drop those stragglers.
const TRACK_CHANGE_RECONCILE_WINDOW_MS = 1000;

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

export function usePlayerState(): UsePlayerState {
  const [state, setState] = useState<PlayerState>(DEFAULT_STATE);
  const lastLocalVolumeAtRef = useRef(0);
  const lastSeekAtRef = useRef(0);
  const seekTargetRef = useRef(0);
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
    // Reset position alongside the track swap. The bridge emits TRACK_CHANGED
    // and POSITION_UPDATED from separate cycles, so without this the progress
    // bar briefly renders with the old position over the new (shorter)
    // duration — which pins it visually at 100%.
    lastTrackChangeAtRef.current = Date.now();
    setState((prev) => ({ ...prev, track, positionSecs: 0 }));
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
      Date.now() - lastSeekAtRef.current < SEEK_STATUS_ECHO_WINDOW_MS
    ) {
      return;
    }
    setState((prev) => ({ ...prev, status }));
  });

  useTauriEvent<number>(EVENTS.POSITION_UPDATED, (positionSecs) => {
    const now = Date.now();
    // Reject pre-seek stragglers: if a position event arrives right after
    // a manual seek and is still far from the seek target, it's stale data
    // from before YTM actually seeked. The next event that lands near the
    // target (or after the reconcile window) will resume normal flow.
    if (
      now - lastSeekAtRef.current < SEEK_RECONCILE_WINDOW_MS &&
      Math.abs(positionSecs - seekTargetRef.current) > SEEK_TOLERANCE_SECS
    ) {
      return;
    }
    // Reject old-track stragglers: right after TRACK_CHANGED, drop any
    // POSITION_UPDATED whose value exceeds the new track's duration — those
    // timestamps belong to the previous song and cause the "jump to 100%
    // then back to 0" flash on track switches.
    if (now - lastTrackChangeAtRef.current < TRACK_CHANGE_RECONCILE_WINDOW_MS) {
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
    lastSeekAtRef.current = Date.now();
    seekTargetRef.current = target;
  }, []);

  return { ...state, applyOptimistic, markSeek };
}
