import { useEffect, useRef } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'vibeytm:theme';

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return mode;
}

function applyTheme(resolved: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', resolved);
  try {
    localStorage.setItem(STORAGE_KEY, resolved);
  } catch {
    // localStorage unavailable — no persistence this session.
  }
}

export function useTheme(mode: ThemeMode): void {
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    applyTheme(resolveTheme(mode));
    try { localStorage.setItem('vibeytm:theme-mode', mode); } catch { /* */ }

    if (mode !== 'system') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (modeRef.current === 'system') {
        applyTheme(resolveTheme('system'));
      }
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [mode]);
}
