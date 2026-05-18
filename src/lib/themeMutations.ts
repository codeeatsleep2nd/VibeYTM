// Theme-change pub/sub.
//
// When SettingsPage (or any future surface) changes the theme mode,
// the mutator calls `notifyThemeChanged(mode)`. `App.tsx` subscribes
// via `subscribeToThemeChange(...)` and updates its `themeMode` state
// so `useTheme` re-applies the `data-theme` attribute immediately.
//
// Mirrors the `libraryMutations.ts` pattern — deliberately tiny, no
// React deps, no framework coupling.

import type { ThemeMode } from '../hooks/useTheme';

type ThemeListener = (mode: ThemeMode) => void;

const listeners = new Set<ThemeListener>();

export function notifyThemeChanged(mode: ThemeMode): void {
  for (const listener of listeners) {
    try {
      listener(mode);
    } catch {
      // Listener threw — swallow so the remaining listeners still fire.
    }
  }
}

export function subscribeToThemeChange(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
