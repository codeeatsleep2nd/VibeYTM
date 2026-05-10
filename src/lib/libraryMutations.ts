// Library-mutation pub/sub.
//
// Whenever a user-initiated mutation invalidates the library snapshot
// (a playlist is created/deleted/renamed, a track is added/removed,
// a playlist is saved/unsaved), the mutator calls
// `notifyLibraryMutated()`. `App.tsx` subscribes via `subscribe(...)`
// and bumps its `libraryVersion`, which forces `LibraryPage` to refetch
// the affected tab on next render even if the page stayed mounted
// behind a playlist-detail overlay.
//
// Kept deliberately tiny: no React deps, no event payload — the only
// thing subscribers need to know is "something changed; refetch when
// you can." Counter monotonically increments so consumers wiring this
// into `useEffect`'s dep array (rather than a callback) see a fresh
// value every notification, no debouncing required.

type Listener = () => void;

const listeners = new Set<Listener>();
let version = 0;

export function notifyLibraryMutated(): void {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Listener errors must not block other subscribers from learning
      // about the mutation. App.tsx is the only real consumer; this is
      // defence-in-depth.
    }
  }
}

export function subscribeToLibraryMutations(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLibraryMutationVersion(): number {
  return version;
}

/** Test-only: reset the registry between tests. */
export function __resetLibraryMutationsForTests(): void {
  listeners.clear();
  version = 0;
}
