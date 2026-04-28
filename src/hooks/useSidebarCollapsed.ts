import { useCallback, useEffect, useState } from 'react';

// Issue #82 — collapsible sidebar (icon-rail variant).
//
// History of this hook:
//   1. Original #82 implementation: 240 px ↔ 64 px icon rail. Reviewer
//      flagged the toggle as unclickable (drag-region overlap) → #92.
//   2. User follow-up on #92: collapse should fully hide the sidebar,
//      not rail. Switched COLLAPSED_WIDTH to '0px'. User then got
//      stuck with the sidebar hidden because the toggle's transparent
//      glyph was hard to find against page content.
//   3. Reverted. Sidebar always visible.
//   4. Re-implemented per user's "redo" request: the icon-rail variant
//      from step 1, but with the toggle now reliably clickable
//      (zIndex 201 + WebkitAppRegion: 'no-drag' + drag region carved
//      via `--sidebar-width`). The 64 px rail keeps the toggle and
//      the nav icons visible at all times — no "I can't find it"
//      regression.

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

  // Apply on mount + every change. Persistence rides the same effect
  // so the side-effect fires once per real state change, not once per
  // setState updater call (StrictMode invokes updaters twice in dev).
  useEffect(() => {
    applyWidth(isCollapsed);
    writePersisted(isCollapsed);
  }, [isCollapsed]);

  const toggle = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return { isCollapsed, toggle };
}
