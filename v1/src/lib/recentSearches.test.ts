import { describe, expect, it, beforeEach, vi } from 'vitest';

// Node 25 + vitest's jsdom env: the global `localStorage` here lacks
// getItem/setItem in some environments. Mirror persistentCache.test.ts's
// in-memory stub so the real logic runs against a real Storage shape.
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

const { MAX_RECENT_SEARCHES, loadRecentSearches, pushRecentSearch, saveRecentSearches } =
  await import('./recentSearches');

const KEY = 'vibeytm.search.recent';

describe('recentSearches', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('loadRecentSearches', () => {
    it('returns [] when storage is empty', () => {
      expect(loadRecentSearches()).toEqual([]);
    });

    it('round-trips a saved list', () => {
      saveRecentSearches(['rosé apt', 'jay chou']);
      expect(loadRecentSearches()).toEqual(['rosé apt', 'jay chou']);
    });

    it('returns [] when JSON is malformed', () => {
      localStorage.setItem(KEY, '{not json');
      expect(loadRecentSearches()).toEqual([]);
    });

    it('drops non-string entries defensively', () => {
      localStorage.setItem(KEY, JSON.stringify(['ok', 42, null, 'fine']));
      expect(loadRecentSearches()).toEqual(['ok', 'fine']);
    });

    it('caps the loaded list at MAX_RECENT_SEARCHES', () => {
      const big = Array.from({ length: 12 }, (_, i) => `q${i}`);
      localStorage.setItem(KEY, JSON.stringify(big));
      expect(loadRecentSearches()).toHaveLength(MAX_RECENT_SEARCHES);
    });

    it('returns [] when the JSON root is not an array', () => {
      localStorage.setItem(KEY, JSON.stringify({ foo: 'bar' }));
      expect(loadRecentSearches()).toEqual([]);
    });
  });

  describe('pushRecentSearch', () => {
    it('prepends a fresh query', () => {
      expect(pushRecentSearch(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    });

    it('moves an existing query to the front (MRU)', () => {
      expect(pushRecentSearch(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    });

    it('matches case-insensitively when deduping', () => {
      expect(pushRecentSearch(['Rosé APT', 'jay'], 'rosé apt')).toEqual([
        'rosé apt',
        'jay',
      ]);
    });

    it('caps result at MAX_RECENT_SEARCHES', () => {
      const seed = ['a', 'b', 'c', 'd', 'e'];
      const out = pushRecentSearch(seed, 'f');
      expect(out).toHaveLength(MAX_RECENT_SEARCHES);
      expect(out[0]).toBe('f');
      expect(out).not.toContain('e'); // oldest dropped
    });

    it('trims whitespace before pushing', () => {
      expect(pushRecentSearch(['x'], '  hello  ')).toEqual(['hello', 'x']);
    });

    it('returns a copy unchanged when the query is empty', () => {
      const seed = ['a', 'b'];
      const out = pushRecentSearch(seed, '   ');
      expect(out).toEqual(seed);
      expect(out).not.toBe(seed); // new array
    });

    it('does not mutate the input array', () => {
      const seed = ['a', 'b'];
      pushRecentSearch(seed, 'c');
      expect(seed).toEqual(['a', 'b']);
    });
  });

  describe('saveRecentSearches', () => {
    it('persists to localStorage as JSON', () => {
      saveRecentSearches(['x', 'y']);
      expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['x', 'y']);
    });

    it('survives a thrown setItem (quota / private mode)', () => {
      const orig = (localStorage as Storage).setItem;
      (localStorage as Storage).setItem = () => {
        throw new Error('quota');
      };
      try {
        expect(() => saveRecentSearches(['x'])).not.toThrow();
      } finally {
        (localStorage as Storage).setItem = orig;
      }
    });
  });
});
