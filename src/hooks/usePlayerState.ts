import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerState, PlaybackStatus, RepeatMode, TrackInfo } from '../lib/types';
import { playerApi } from '../lib/ipc';
import { EVENTS } from '../lib/events';
import { useTauriEvent } from './useTauriEvent';

// Why (#36/#42): the bridge is a poll-driven mirror of YTM. After a local
// set_volume call, YTM's <video>.volume takes ~3 poll cycles (~450ms) to
// stabilize, and the previous 500ms window expired mid-settle — a stale
// intermediate value landed AFTER the window closed and overwrote the
// optimistic state, so the thumb bounced. 1200ms covers the full settling
// window with margin for click-to-jump and fast drags.
const VOLUME_ECHO_WINDOW_MS = 1200;

// Why (#41): YTM briefly reports status=paused during a seek while the
// <video> element reseats the buffer, then flips back to playing. The UI
// used to accept that stale "paused" event unconditionally and rendered the
// pause glyph for a frame before the next event corrected it. This window
// suppresses those echoes when we are optimistically still playing.
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
    // #41: YTM drops to "paused" for a cycle or two while a seek reseats
    // the buffer, then flips back to "playing". Taking that intermediate
    // value as truth flashed the pause glyph for a frame. Drop it while
    // we are optimistically still playing and inside the echo window.
    if (
      status === 'paused' &&
      statusRef.current === 'playing' &&
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
    // #36/#42: during a local drag or click-to-jump, the bridge poller can
    // emit intermediate <video>.volume values from BEFORE the latest
    // set_volume took effect. Accepting them overwrote the optimistic
    // state mid-drag and the thumb visibly bounced back and forth.
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

  // #37: the bridge was already emitting login-changed on sign-out, but no
  // one downstream consumed it — the shared PlayerState kept the last
  // track's title/artist/artwork/progress, so the controller bar looked
  // identical to a signed-in session until the next app launch. Reset to
  // defaults so the bottom bar returns to "No track playing". Account info
  // clears separately via useAccountInfo.
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
