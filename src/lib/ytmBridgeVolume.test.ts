// Behavioural test for the bridge JS's volume seed-then-persist contract.
//
// The bug: every YTM track navigation creates a fresh page context where
// `__VIBEYTM_DESIRED_VOLUME_PCT__` is undefined. The prototype-level
// volume lock then no-ops on the first frame of the new track, audio
// plays at default volume=1, and the user hears a brief loud burst until
// Rust re-pushes the value one poll cycle later.
//
// The fix has two halves that MUST stay in sync:
//   1. Bridge init (top of `ytm-player-bridge.js`) reads
//      `localStorage.__VIBEYTM_VOLUME_PCT__` and seeds the global BEFORE
//      `installVolumeLock` runs.
//   2. The `set_volume` IPC handler writes the same key to localStorage.
//
// Either half alone defeats the fix. This test loads the actual shipped
// bridge file, evaluates it in vitest's jsdom environment, and asserts
// the seed runs as advertised — so a future refactor can't silently drop
// either half without failing CI.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Vite/vitest's `?raw` suffix loads the file contents as a string at
// import time. Lets the test pin the SHIPPED bridge source instead of a
// duplicate in this file. The `?raw` module suffix is recognised by the
// project's Vite types via `vite/client` (see `vite-env.d.ts`).
import bridgeSource from '../../scripts/inject/ytm-player-bridge.js?raw';

// Node 25 + vitest's jsdom env: the global `localStorage` here lacks
// getItem/setItem in some configurations (same workaround used by
// persistentCache.test.ts and recentSearches.test.ts).
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

vi.stubGlobal('localStorage', new MemoryStorage());

declare global {
  // eslint-disable-next-line no-var
  var __VIBEYTM_DESIRED_VOLUME_PCT__: number | undefined;
  // eslint-disable-next-line no-var
  var __VIBEYTM_VOLUME_LOCK_INSTALLED__: boolean | undefined;
}

function evalBridge(): void {
  // The bridge is an IIFE that references the ambient `window`, `document`,
  // and `localStorage` — vitest's jsdom env provides all three. Evaluating
  // its source text here runs the IIFE against those globals.
  new Function(bridgeSource)();
}

function resetBridgeGlobals(): void {
  delete (globalThis as Record<string, unknown>).__VIBEYTM_DESIRED_VOLUME_PCT__;
  delete (globalThis as Record<string, unknown>).__VIBEYTM_VOLUME_LOCK_INSTALLED__;
  delete (globalThis as Record<string, unknown>).__VIBEYTM_STATE__;
  delete (globalThis as Record<string, unknown>).__VIBEYTM_DEBUG__;
  delete (globalThis as Record<string, unknown>).__VIBEYTM_LOGGED_IN__;
  delete (globalThis as Record<string, unknown>).__VIBEYTM_ACCOUNT__;
}

describe('ytm-player-bridge: volume seed-then-persist contract', () => {
  beforeEach(() => {
    resetBridgeGlobals();
    localStorage.clear();
    // Stub setInterval so the bridge's polling loop doesn't keep running
    // across tests and pollute later assertions.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetBridgeGlobals();
  });

  it('seeds __VIBEYTM_DESIRED_VOLUME_PCT__ from localStorage on init', () => {
    localStorage.setItem('__VIBEYTM_VOLUME_PCT__', '55');
    evalBridge();
    expect(window.__VIBEYTM_DESIRED_VOLUME_PCT__).toBe(55);
  });

  it('leaves the global undefined when localStorage has no entry', () => {
    // First-launch / cold-start case. The Rust bridge_just_loaded path
    // pushes the value via IPC to seed the storage; until then, the
    // global stays undefined and the volume lock no-ops (matches the
    // prior behaviour, just bounded to one launch instead of every
    // track change).
    evalBridge();
    expect(window.__VIBEYTM_DESIRED_VOLUME_PCT__).toBeUndefined();
  });

  it('clamps a stored value above 100 to 100', () => {
    localStorage.setItem('__VIBEYTM_VOLUME_PCT__', '999');
    evalBridge();
    expect(window.__VIBEYTM_DESIRED_VOLUME_PCT__).toBe(100);
  });

  it('clamps a stored value below 0 to 0', () => {
    localStorage.setItem('__VIBEYTM_VOLUME_PCT__', '-50');
    evalBridge();
    expect(window.__VIBEYTM_DESIRED_VOLUME_PCT__).toBe(0);
  });

  it('rounds a fractional stored value to an integer percent', () => {
    localStorage.setItem('__VIBEYTM_VOLUME_PCT__', '42.6');
    evalBridge();
    expect(window.__VIBEYTM_DESIRED_VOLUME_PCT__).toBe(43);
  });

  it('ignores a non-numeric stored value', () => {
    localStorage.setItem('__VIBEYTM_VOLUME_PCT__', 'not-a-number');
    evalBridge();
    expect(window.__VIBEYTM_DESIRED_VOLUME_PCT__).toBeUndefined();
  });

  it('preserves the bridge file structure (locking the seed-then-persist contract by source pattern)', () => {
    // Belt-and-suspenders: lock the file structure too. The behavioural
    // tests above prove the seed works; this asserts that the matching
    // localStorage WRITE in the `set_volume` handler is still present
    // (we can't unit-test that handler without reproducing the IPC
    // command-dispatch surface, but the source pattern is enough to
    // catch a drop during refactor).
    expect(bridgeSource).toMatch(
      /localStorage\.setItem\(\s*['"]__VIBEYTM_VOLUME_PCT__['"]/,
    );
    expect(bridgeSource).toMatch(
      /localStorage\.getItem\(\s*['"]__VIBEYTM_VOLUME_PCT__['"]/,
    );
  });
});
