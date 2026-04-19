import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerState, PlaybackStatus, RepeatMode, TrackInfo } from '../lib/types';
import { playerApi } from '../lib/ipc';
import { EVENTS } from '../lib/events';
import { useTauriEvent } from './useTauriEvent';

// Drop VOLUME_CHANGED echoes that arrive within this window of a local
// optimistic set, so fast drags aren't overwritten by stale intermediate
// values from the YTM bridge poller.
const VOLUME_ECHO_WINDOW_MS = 500;

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
}

export function usePlayerState(): UsePlayerState {
  const [state, setState] = useState<PlayerState>(DEFAULT_STATE);
  const lastLocalVolumeAtRef = useRef(0);

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

  return { ...state, applyOptimistic };
}
