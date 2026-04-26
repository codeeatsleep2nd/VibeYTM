// MRU list of submitted search queries, persisted to localStorage so chips
// in SearchPage's empty state survive across sessions. Lives outside the
// component so the load/save/push behaviour is unit-testable without
// mounting the page.

const STORAGE_KEY = 'vibeytm.search.recent';
export const MAX_RECENT_SEARCHES = 5;

export function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT_SEARCHES)
      : [];
  } catch {
    return [];
  }
}

export function saveRecentSearches(list: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage may be unavailable (private mode, quota); recents are best-effort.
  }
}

/** Push `query` to the front of `prev` after stripping any existing copy
 *  (case-insensitive) and capping at MAX_RECENT_SEARCHES. Pure — caller
 *  decides when to persist. */
export function pushRecentSearch(prev: readonly string[], query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [...prev];
  return [
    trimmed,
    ...prev.filter((x) => x.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);
}
