import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerState, PlaybackStatus, RepeatMode, TrackInfo } from '../lib/types';
import { playerApi } from '../lib/ipc';
import { EVENTS } from '../lib/events';
import { useTauriEvent } from './useTauriEvent';

// Drop VOLUME_CHANGED echoes that arrive within this window of a local
// optimistic set, so fast drags aren't overwritten by stale intermediate
// values from the YTM bridge poller.
const VOLUME_ECHO_WINDOW_MS = 500;

// After a manual seek, POSITION_UPDATED events emitted before YTM finished
// seeking carry pre-seek timestamps that would visually bounce the thumb
// back to the old position. Drop those within this reconciliation window
// ONLY if they are far from the seek target.
const SEEK_RECONCILE_WINDOW_MS = 800;
const SEEK_TOLERANCE_SECS = 2;

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

  useEffect(() => {
    playerApi.getState().then((s) => {
      setState(s);
    }).catch(() => {
      // Backend not ready yet — keep defaults
    });
  }, []);

  useTauriEvent<TrackInfo>(EVENTS.TRACK_CHANGED, (track) => {
    // Reset position alongside the track swap. The bridge emits TRACK_CHANGED
    // and POSITION_UPDATED from separate cycles, so without this the progress
    // bar briefly renders with the old position over the new (shorter)
    // duration — which pins it visually at 100%.
    setState((prev) => ({ ...prev, track, positionSecs: 0 }));
  });

  useTauriEvent<PlaybackStatus>(EVENTS.STATUS_CHANGED, (status) => {
    setState((prev) => ({ ...prev, status }));
  });

  useTauriEvent<number>(EVENTS.POSITION_UPDATED, (positionSecs) => {
    // Reject pre-seek stragglers: if a position event arrives right after
    // a manual seek and is still far from the seek target, it's stale data
    // from before YTM actually seeked. The next event that lands near the
    // target (or after the reconcile window) will resume normal flow.
    const sinceSeek = Date.now() - lastSeekAtRef.current;
    if (
      sinceSeek < SEEK_RECONCILE_WINDOW_MS &&
      Math.abs(positionSecs - seekTargetRef.current) > SEEK_TOLERANCE_SECS
    ) {
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
