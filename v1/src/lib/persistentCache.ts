// Tiny localStorage-backed cache for browse data that drives card
// clickability (home shelves, library playlists/albums, etc.).
//
// Why this exists: items rendered in the home/library grid carry the IDs
// (`playlistId`, `browseId`, `videoId`) that the click handlers feed back
// into the YTM API. When the in-memory module-level cache is empty after
// a cold start, the page renders an empty grid until the network call
// returns — and during the YTM webview's mid-navigation window, that
// fetch can hang for tens of seconds. Persisting the last-known-good
// payload to localStorage means the grid renders instantly on relaunch
// from cache, and the network call becomes a background refresh instead
// of a blocking dependency.
//
// 7-day TTL: long enough that a user reopening the app the next morning
// sees their library immediately, short enough that genuinely stale
// catalog state (deleted playlists, renamed albums) gets refreshed
// within a week without manual intervention.

const NAMESPACE = 'vibeytm:browse:v1';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Envelope<T> {
  ts: number;
  data: T;
}

export function readCache<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  try {
    const raw = localStorage.getItem(`${NAMESPACE}:${key}`);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (Date.now() - env.ts > ttlMs) return null;
    return env.data;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  try {
    const env: Envelope<T> = { ts: Date.now(), data };
    localStorage.setItem(`${NAMESPACE}:${key}`, JSON.stringify(env));
  } catch {
    // Quota exceeded or storage unavailable — degrade silently. The
    // in-memory cache layer above us still works for the rest of the
    // session.
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(`${NAMESPACE}:${key}`);
  } catch {
    // Ignore — we'll just have a slightly stale entry until natural TTL.
  }
}
