// Issue #83 — recently-played history.
//
// Stores a small, recency-ordered list of tracks the user has listened
// to in this app. Persisted to localStorage so the History page is
// populated immediately on next launch (the YTM bridge can't tell us
// what the user played weeks ago, so we keep our own log).
//
// Each entry is a `TrackInfo` plus a wall-clock `playedAt` timestamp.
// Re-listening to a track moves it to the front of the list (LRU on
// videoId) instead of duplicating, mirroring Apple Music's "Recently
// played" behavior.

import type { TrackInfo } from './types';

const STORAGE_KEY = 'vibeytm:playback-history';
export const MAX_HISTORY_ENTRIES = 100;

export interface HistoryEntry {
  track: TrackInfo;
  /** Wall-clock ms when this play started. Drives the "X minutes ago" label. */
  playedAt: number;
}

/**
 * Pure, easily-tested append helper. Returns a NEW list with `entry`
 * promoted to position 0; any existing entry with the same `videoId`
 * is removed first so re-plays bubble to the top instead of stacking.
 * The list is capped at `MAX_HISTORY_ENTRIES` from the head.
 */
export function pushHistoryEntry(
  prev: ReadonlyArray<HistoryEntry>,
  entry: HistoryEntry,
): HistoryEntry[] {
  if (!entry.track.videoId) return prev as HistoryEntry[];
  const filtered = prev.filter((e) => e.track.videoId !== entry.track.videoId);
  const next = [entry, ...filtered];
  return next.slice(0, MAX_HISTORY_ENTRIES);
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive parse — drop entries that don't shape-match. Saves us
    // from a corrupted localStorage payload crashing the History page.
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof e.playedAt === 'number' &&
          !!e.track &&
          typeof e.track === 'object' &&
          typeof e.track.videoId === 'string' &&
          typeof e.track.title === 'string',
      )
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export function saveHistory(entries: ReadonlyArray<HistoryEntry>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage may be full / unavailable (private mode). Best-effort.
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
