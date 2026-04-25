import { useEffect, useState } from 'react';
import { browseApi } from '../lib/ipc';
import type { Lyrics } from '../lib/types';

// Shared caches — a Map for hits and a Map for confirmed misses so the UI
// can instantly render both states without re-hitting YTM. A pending
// Promise map de-duplicates concurrent fetches from PlayerBar + NowPlaying.
//
// Transient errors (webview mid-navigation, timeouts, bridge glitches) are
// NOT cached permanently — they only enter the failure cooldown below.
const lyricsCache = new Map<string, Lyrics>();
const lyricsMisses = new Map<string, string | null>();
const inFlight = new Map<string, Promise<void>>();

// localStorage cache: persists lyrics across app restarts so the panel
// renders synchronously on second open of any previously-fetched track.
// Keyed by videoId. Hit lyrics live indefinitely (until eviction below);
// confirmed misses persist with a short TTL so we eventually re-probe in
// case YTM later indexes timed lyrics for the track. Transient errors
// also enter a short cooldown so a saturated YTM /next channel doesn't
// get hammered with retries during the outage.
const HITS_KEY = 'vibeytm:lyrics:v1:hits';
const MISSES_KEY = 'vibeytm:lyrics:v1:misses';
const FAILURES_KEY = 'vibeytm:lyrics:v1:failures';
const MAX_HITS_BYTES = 4_000_000; // ~4MB — well under typical 5MB localStorage cap
const MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    const s = JSON.stringify(value);
    if (key === HITS_KEY && s.length > MAX_HITS_BYTES) {
      // Drop oldest entries until we fit. The Record's key order is
      // insertion order; we iterate and pop until size is under cap.
      const entries = Object.entries(value as Record<string, Lyrics>);
      while (entries.length > 1 && JSON.stringify(Object.fromEntries(entries)).length > MAX_HITS_BYTES) {
        entries.shift();
      }
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
      return;
    }
    localStorage.setItem(key, s);
  } catch {
    // Quota exceeded or storage unavailable — degrade silently.
  }
}

// Hydrate the in-memory caches from localStorage on module load so the
// first React render of the lyrics panel can use the cache without a
// Tauri IPC round-trip.
(function hydrate(): void {
  const hits = readJson<Record<string, Lyrics>>(HITS_KEY, {});
  for (const [vid, lyrics] of Object.entries(hits)) {
    lyricsCache.set(vid, lyrics);
  }
  const misses = readJson<Record<string, number>>(MISSES_KEY, {});
  const now = Date.now();
  let evictedMisses = false;
  for (const [vid, ts] of Object.entries(misses)) {
    if (now - ts > MISS_TTL_MS) {
      delete misses[vid];
      evictedMisses = true;
    } else {
      lyricsMisses.set(vid, null);
    }
  }
  if (evictedMisses) writeJson(MISSES_KEY, misses);
})();

function persistHit(videoId: string, lyrics: Lyrics): void {
  const hits = readJson<Record<string, Lyrics>>(HITS_KEY, {});
  hits[videoId] = lyrics;
  writeJson(HITS_KEY, hits);
}

function persistMiss(videoId: string): void {
  const misses = readJson<Record<string, number>>(MISSES_KEY, {});
  misses[videoId] = Date.now();
  writeJson(MISSES_KEY, misses);
}

function inFailureCooldown(videoId: string): boolean {
  const failures = readJson<Record<string, number>>(FAILURES_KEY, {});
  const ts = failures[videoId];
  if (!ts) return false;
  if (Date.now() - ts > FAILURE_COOLDOWN_MS) {
    delete failures[videoId];
    writeJson(FAILURES_KEY, failures);
    return false;
  }
  return true;
}

function markFailure(videoId: string): void {
  const failures = readJson<Record<string, number>>(FAILURES_KEY, {});
  failures[videoId] = Date.now();
  writeJson(FAILURES_KEY, failures);
}

// Probes that fire the instant a track-change event arrives often collide
// with YTM's own webview navigation ("JS fetch error: Load failed"). A
// short delay lets the WKWebView settle before we ask it to run a fetch.
const PROBE_DEBOUNCE_MS = 2000;

export type LyricsStatus = 'idle' | 'loading' | 'available' | 'missing';

export interface UseLyricsResult {
  status: LyricsStatus;
  lyrics: Lyrics | null;
  error: string | null;
}

export interface LyricsLookup {
  videoId: string;
  artist?: string | null;
  title?: string | null;
  durationSecs?: number | null;
}

function hasContent(l: Lyrics): boolean {
  const text = l.text?.trim() ?? '';
  const lines = l.lines ?? null;
  return text.length > 0 || (Array.isArray(lines) && lines.length > 0);
}

/**
 * Kick off a background lyrics fetch for a track the user is likely to
 * play soon (e.g. next in the queue). Fire-and-forget: result lands in
 * the shared cache, so when the user actually plays the track and opens
 * the LRC panel, it's already available. Safe to call with any frequency
 * — repeat calls for the same videoId are no-ops thanks to the cache +
 * in-flight maps.
 */
export function preloadLyrics(lookup: LyricsLookup): void {
  if (!lookup.videoId) return;
  void ensureFetch(lookup);
}

async function fetchOnce(lookup: LyricsLookup) {
  return browseApi.getLyrics({
    videoId: lookup.videoId,
    artist: lookup.artist ?? null,
    title: lookup.title ?? null,
    durationSecs: lookup.durationSecs ?? null,
  });
}

function ensureFetch(lookup: LyricsLookup): Promise<void> {
  const { videoId } = lookup;
  if (lyricsCache.has(videoId) || lyricsMisses.has(videoId)) {
    return Promise.resolve();
  }
  // Recent transport failure → don't immediately retry. The cooldown
  // expires after FAILURE_COOLDOWN_MS so the user isn't permanently
  // blocked when the YTM API recovers.
  if (inFailureCooldown(videoId)) {
    return Promise.resolve();
  }
  const existing = inFlight.get(videoId);
  if (existing) return existing;

  const runOnce = async (): Promise<'ok' | 'empty' | 'error'> => {
    try {
      const result = await fetchOnce(lookup);
      if (hasContent(result)) {
        lyricsCache.set(videoId, result);
        persistHit(videoId, result);
        return 'ok';
      }
      return 'empty';
    } catch {
      return 'error';
    }
  };

  const p = (async () => {
    const first = await runOnce();
    if (first === 'ok') return;
    if (first === 'empty') {
      lyricsMisses.set(videoId, null);
      persistMiss(videoId);
      return;
    }
    // Transient error: wait and retry once.
    await new Promise((r) => setTimeout(r, 1500));
    const second = await runOnce();
    if (second === 'empty') {
      lyricsMisses.set(videoId, null);
      persistMiss(videoId);
      return;
    }
    if (second === 'error') {
      // Two failures in a row — enter cooldown so we don't keep
      // retrying when YTM API is unhappy.
      markFailure(videoId);
    }
  })().finally(() => {
    inFlight.delete(videoId);
  });

  inFlight.set(videoId, p);
  return p;
}

/**
 * Subscribe to lyrics availability for a given track. Safe to call from
 * multiple components — the underlying fetch is de-duplicated and cached.
 *
 * `enabled = false` holds off the fetch entirely (used by NowPlaying when
 * the panel is closed). `immediate = true` skips the debounce — NowPlaying
 * uses this because the user has just clicked to open the panel and wants
 * lyrics right now.
 */
export function useLyrics(
  lookup: LyricsLookup | null,
  enabled = true,
  immediate = false,
): UseLyricsResult {
  const [, force] = useState(0);

  const videoId = lookup?.videoId;
  // Pick up lookup metadata in deps so a later-arriving artist/title (common
  // on cold bridge load) re-triggers the probe with richer params.
  const artist = lookup?.artist ?? null;
  const title = lookup?.title ?? null;
  const duration = lookup?.durationSecs ?? null;

  useEffect(() => {
    if (!enabled || !videoId) return;
    if (lyricsCache.has(videoId) || lyricsMisses.has(videoId)) return;

    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      ensureFetch({ videoId, artist, title, durationSecs: duration }).then(() => {
        if (!cancelled) force((v) => v + 1);
      });
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (immediate || inFlight.has(videoId)) {
      run();
    } else {
      timer = setTimeout(run, PROBE_DEBOUNCE_MS);
    }

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [videoId, enabled, immediate, artist, title, duration]);

  if (!videoId) {
    return { status: 'idle', lyrics: null, error: null };
  }
  const hit = lyricsCache.get(videoId);
  if (hit) {
    return { status: 'available', lyrics: hit, error: null };
  }
  if (lyricsMisses.has(videoId)) {
    return { status: 'missing', lyrics: null, error: lyricsMisses.get(videoId) ?? null };
  }
  return { status: 'loading', lyrics: null, error: null };
}
