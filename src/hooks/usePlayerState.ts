import { useSyncExternalStore } from 'react';
import type { PlayerState } from '../lib/types';
import {
  applyOptimistic,
  getSnapshot,
  markSeek,
  subscribe,
} from '../lib/playerStore';

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

/**
 * Subscribe to the full shared player state. Re-renders on any change.
 * Used by the handful of components that genuinely display most of the
 * state (player chrome, now-playing card/overlay, lyrics, queue panel).
 *
 * Lightweight consumers that only need one slice — `QueueArtwork` reads
 * just `activePlaylistId`, and there are ~100 of those mounted — MUST use
 * {@link usePlayerSelector} instead so a `player:position` tick doesn't
 * fan out to a re-render on every queue row.
 */
export function usePlayerState(): UsePlayerState {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return { ...state, applyOptimistic, markSeek };
}

/**
 * Subscribe to a single derived slice of the shared player state. The
 * component re-renders only when `selector(state)` changes (compared with
 * `Object.is`).
 *
 * The selector MUST return a primitive or an otherwise referentially-
 * stable value — returning a fresh object/array on every call would make
 * React see a change every tick and re-render in a loop. For the slices
 * the app needs today (`activePlaylistId`, a string) that holds trivially.
 */
export function usePlayerSelector<T>(selector: (state: PlayerState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()));
}
