import { useSyncExternalStore } from 'react';

/**
 * Singleton toast registry. Module-level state + subscriber set lets any
 * code (React tree or plain modules like IPC handlers) trigger a toast
 * without prop-drilling or a Context provider. Single-instance contract:
 * showing a new toast replaces the prior one.
 *
 * Usage:
 *   import { toast } from './lib/toast';
 *   toast.show({ message: 'Added to Liked Music' });
 *
 * In components, subscribe via the hook so the singleton's changes
 * trigger React renders:
 *   const current = useToastState();
 *
 * The actual `<Toast />` component (in `components/Toast.tsx`) is the
 * sole consumer of `useToastState` — mount it once at App.tsx.
 */

export interface ToastSpec {
  /** Stable key for React reconciliation. Generated internally. */
  id: string;
  /** Visible message. */
  message: string;
  /** Auto-dismiss in milliseconds. Default 4000. */
  durationMs?: number;
}

let currentToast: ToastSpec | null = null;
const subscribers = new Set<() => void>();
let nextId = 0;

function notify(): void {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // Swallow subscriber errors so one bad listener can't break the rest.
    }
  }
}

export const toast = {
  /** Replace the current toast with this one. Returns the new id so the
   *  caller can dismiss programmatically (e.g. on a parent unmount). */
  show(spec: Omit<ToastSpec, 'id'>): string {
    const id = `toast-${nextId++}`;
    currentToast = { ...spec, id };
    notify();
    return id;
  },
  /** Dismiss whatever toast is currently shown (no-op if none). */
  dismiss(): void {
    if (currentToast === null) return;
    currentToast = null;
    notify();
  },
  /** Dismiss only if the current toast matches the given id. Safe to call
   *  from a `setTimeout` whose toast may have been replaced by a newer one. */
  dismissIf(id: string): void {
    if (currentToast?.id !== id) return;
    currentToast = null;
    notify();
  },
};

/** Subscribe to toast state changes. Use only from `<Toast />`. */
export function useToastState(): ToastSpec | null {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    () => currentToast,
    () => null,
  );
}

/** Test-only — reset module state between vitest runs. */
export function __resetToastForTests(): void {
  currentToast = null;
  subscribers.clear();
  nextId = 0;
}
