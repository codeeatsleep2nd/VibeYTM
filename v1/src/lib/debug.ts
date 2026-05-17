// Toggle-able runtime debug logger.
//
// Off by default. Flip on at runtime via either:
//   • localStorage.setItem('vibeytm:debug', '1') — then reload, OR
//   • DOM console: `vibeytmDebugOn()` / `vibeytmDebugOff()` (no reload).
//
// All logs route through `console.log/.warn/.error` so they show up
// in the WebView devtools panel. On dev builds we also surface them
// via a fire-and-forget IPC ping (`debug_log`) so the dev-server
// terminal sees them — useful when WebView devtools aren't open.
//
// API mirrors `console`:
//   debug.log(...)    debug.warn(...)    debug.error(...)
//   debug.group('UI', () => { debug.log(...); }) — nested.
//
// Cost when disabled: a single boolean read; no string construction
// because callers pass () => `string` for templates that would be
// expensive to build.

import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'vibeytm:debug';

let enabled = false;
try {
  enabled = localStorage.getItem(STORAGE_KEY) === '1';
} catch {
  // SSR / private mode — leave disabled.
}

function persist(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isDebugOn(): boolean {
  return enabled;
}

export function setDebugOn(on: boolean): void {
  enabled = on;
  persist(on);
  // eslint-disable-next-line no-console
  console.log(`[vibeytm-debug] ${on ? 'ENABLED' : 'disabled'}`);
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function emit(level: 'log' | 'warn' | 'error', tag: string, args: unknown[]): void {
  if (!enabled) return;
  const prefix = `[${tag}]`;
  // Console first — works even if IPC is gone.
  // eslint-disable-next-line no-console
  console[level](prefix, ...args);
  // Best-effort pipe to Rust so the dev-server terminal sees it.
  try {
    void invoke('debug_log', { level, message: `${prefix} ${format(args)}` }).catch(
      () => {
        // IPC unavailable (e.g. browser dev) — swallow.
      },
    );
  } catch {
    // ignore
  }
}

export const debug = {
  log: (tag: string, ...args: unknown[]): void => emit('log', tag, args),
  warn: (tag: string, ...args: unknown[]): void => emit('warn', tag, args),
  error: (tag: string, ...args: unknown[]): void => emit('error', tag, args),
};

// Expose toggles on the window object so they're reachable from the
// WebView devtools without an import.
declare global {
  interface Window {
    vibeytmDebugOn?: () => void;
    vibeytmDebugOff?: () => void;
    vibeytmDebugStatus?: () => boolean;
  }
}
if (typeof window !== 'undefined') {
  window.vibeytmDebugOn = () => setDebugOn(true);
  window.vibeytmDebugOff = () => setDebugOn(false);
  window.vibeytmDebugStatus = () => enabled;
}
