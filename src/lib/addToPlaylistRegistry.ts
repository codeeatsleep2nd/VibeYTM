import { useSyncExternalStore } from 'react';

/**
 * Singleton registry for the "Add to Playlist" picker. Same pattern as
 * `lib/toast.ts` — module state + subscriber set + `useSyncExternalStore`.
 *
 * Why a singleton instead of a `morph` field on `ContextMenuItem`:
 * extending the generic ContextMenu primitive with a single use case
 * mixes concerns. The registry approach keeps the menu primitive
 * unchanged and the picker is a peer of Toast in architectural shape.
 *
 * Multi-track behaviour (eng-review A2): the registry is single-instance.
 * Calling `openAddToPlaylistPicker(...)` while the picker is already open
 * REPLACES the previous value, which causes <AddToPlaylistPicker /> to
 * re-anchor to the new track at the new cursor position.
 */

export interface AddToPlaylistRequest {
  videoId: string;
  trackTitle: string;
  /** Cursor position from the originating right-click. The picker uses
   *  this as its anchor with the same viewport-flip logic as ContextMenu. */
  position: { x: number; y: number };
}

let state: AddToPlaylistRequest | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // Don't let one bad subscriber break the rest.
    }
  }
}

export function openAddToPlaylistPicker(req: AddToPlaylistRequest): void {
  state = req;
  notify();
}

export function closeAddToPlaylistPicker(): void {
  if (state === null) return;
  state = null;
  notify();
}

export function useAddToPlaylistRequest(): AddToPlaylistRequest | null {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    () => state,
    () => null,
  );
}

/** Test-only — reset module state between vitest runs. */
export function __resetAddToPlaylistRegistryForTests(): void {
  state = null;
  subscribers.clear();
}
