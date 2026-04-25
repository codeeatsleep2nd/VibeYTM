import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Node 25 ships a stub `localStorage` global that lacks getItem/setItem,
// and jsdom's window.localStorage doesn't propagate to globalThis here.
// Provide a deterministic in-memory implementation for these tests so we
// exercise the real persistentCache logic against a real Storage shape.
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

// Import AFTER the stub so the module under test sees the same global.
const { clearCache, readCache, writeCache } = await import('./persistentCache');

describe('persistentCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when no entry exists for the key', () => {
    expect(readCache('home:shelves')).toBeNull();
  });

  it('round-trips a value within the default TTL', () => {
    writeCache('home:shelves', { shelves: [{ id: 'a' }] });
    expect(readCache('home:shelves')).toEqual({ shelves: [{ id: 'a' }] });
  });

  it('namespaces the localStorage key under vibeytm:browse:v1', () => {
    writeCache('library:playlists', [{ playlistId: 'PL1' }]);
    const raw = localStorage.getItem('vibeytm:browse:v1:library:playlists');
    expect(raw).not.toBeNull();
    const env = JSON.parse(raw!);
    expect(env.data).toEqual([{ playlistId: 'PL1' }]);
    expect(typeof env.ts).toBe('number');
  });

  it('returns null when the entry is older than the default TTL (7 days)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
    writeCache('explore:shelves', { ok: true });

    vi.setSystemTime(new Date('2026-04-08T00:00:01Z'));
    expect(readCache('explore:shelves')).toBeNull();
  });

  it('still returns the entry just before the TTL expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
    writeCache('explore:shelves', { ok: true });

    vi.setSystemTime(new Date('2026-04-07T23:59:00Z'));
    expect(readCache('explore:shelves')).toEqual({ ok: true });
  });

  it('respects a caller-supplied TTL override', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
    writeCache('home:shelves', { ok: true });

    // 31 minutes later — past a 30-minute override but well within the
    // 7-day default.
    vi.setSystemTime(new Date('2026-04-01T00:31:00Z'));
    const thirtyMinutes = 30 * 60 * 1000;
    expect(readCache('home:shelves', thirtyMinutes)).toBeNull();
    expect(readCache('home:shelves')).toEqual({ ok: true });
  });

  it('returns null when the stored payload is malformed JSON', () => {
    localStorage.setItem('vibeytm:browse:v1:home:shelves', '{not json');
    expect(readCache('home:shelves')).toBeNull();
  });

  it('overwrites an existing entry on a second write', () => {
    writeCache('library:albums', [{ id: 'A' }]);
    writeCache('library:albums', [{ id: 'B' }]);
    expect(readCache('library:albums')).toEqual([{ id: 'B' }]);
  });

  it('clearCache removes only the targeted key', () => {
    writeCache('home:shelves', { home: true });
    writeCache('explore:shelves', { explore: true });
    clearCache('home:shelves');
    expect(readCache('home:shelves')).toBeNull();
    expect(readCache('explore:shelves')).toEqual({ explore: true });
  });

  it('writeCache degrades silently when localStorage throws (quota)', () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(() => writeCache('home:shelves', { big: 'payload' })).not.toThrow();
    } finally {
      localStorage.setItem = original;
    }
  });

  it('preserves array shape across the round trip', () => {
    writeCache('library:songs', [{ videoId: 'a' }, { videoId: 'b' }]);
    const out = readCache<{ videoId: string }[]>('library:songs');
    expect(Array.isArray(out)).toBe(true);
    expect(out?.[1].videoId).toBe('b');
  });

  it('isolates entries by key — writes to one do not affect another', () => {
    writeCache('home:shelves', { which: 'home' });
    writeCache('explore:shelves', { which: 'explore' });
    expect(readCache('home:shelves')).toEqual({ which: 'home' });
    expect(readCache('explore:shelves')).toEqual({ which: 'explore' });
  });
});
