import { useEffect, useState } from 'react';
import type { PlayerState, PlaybackStatus, TrackInfo } from '../lib/types';
import { playerApi } from '../lib/ipc';
import { EVENTS } from '../lib/events';
import { useTauriEvent } from './useTauriEvent';

const DEFAULT_STATE: PlayerState = {
  status: 'idle',
  track: null,
  positionSecs: 0,
  volume: 1.0,
  isLiked: false,
  repeatMode: 'none',
  isShuffled: false,
  queue: [],
};

export function usePlayerState(): PlayerState {
  const [state, setState] = useState<PlayerState>(DEFAULT_STATE);

  useEffect(() => {
    playerApi.getState().then((s) => {
      setState(s);
    }).catch(() => {
      // Backend not ready yet — keep defaults
    });
  }, []);

  useTauriEvent<TrackInfo>(EVENTS.TRACK_CHANGED, (track) => {
    setState((prev) => ({ ...prev, track }));
  });

  useTauriEvent<PlaybackStatus>(EVENTS.STATUS_CHANGED, (status) => {
    setState((prev) => ({ ...prev, status }));
  });

  useTauriEvent<number>(EVENTS.POSITION_UPDATED, (positionSecs) => {
    setState((prev) => ({ ...prev, positionSecs }));
  });

  useTauriEvent<number>(EVENTS.VOLUME_CHANGED, (volume) => {
    setState((prev) => ({ ...prev, volume }));
  });

  useTauriEvent<PlayerState>(EVENTS.PLAYER_STATE_CHANGED, (newState) => {
    setState(newState);
  });

  return state;
}
