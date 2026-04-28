import { useCallback, useEffect, useState } from 'react';

// Issue #82: collapsible sidebar. Persisted across sessions in
// localStorage so the user's choice survives a restart. The CSS
// custom property `--sidebar-width` is the single point of truth —
// every consumer (AppShell grid, PlayerChrome.left, NowPlaying.left)
// already reads it, so swapping the value here updates the whole
// layout without prop drilling. Set on `document.documentElement` so
// `position: fixed` descendants see the change.

const STORAGE_KEY = 'vibeytm:sidebar-collapsed';
const EXPANDED_WIDTH = '240px';
const COLLAPSED_WIDTH = '64px';

function readPersisted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePersisted(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}

function applyWidth(collapsed: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    '--sidebar-width',
    collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
  );
}

export function useSidebarCollapsed(): {
  isCollapsed: boolean;
  toggle: () => void;
} {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => readPersisted());

  // Apply on mount + every change. Includes the first render so the
  // CSS var is correct before the layout settles, avoiding a flash.
  // Persistence rides the same effect so the side-effect fires once
  // per real state change, not once per setState updater call —
  // React StrictMode invokes updater functions twice in dev to surface
  // impure logic, so the localStorage write was previously running
  // twice. (Idempotent in practice, but the rule is still: no
  // side-effects inside updaters.)
  useEffect(() => {
    applyWidth(isCollapsed);
    writePersisted(isCollapsed);
  }, [isCollapsed]);

  const toggle = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return { isCollapsed, toggle };
}
