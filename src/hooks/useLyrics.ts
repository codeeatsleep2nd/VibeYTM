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
// v3 namespace bump (2026-04-26): hits were cached indefinitely keyed
// by videoId, so any wrong-lyrics result the matcher produced in a
// previous version stayed pinned to that track forever — improvements
// to `clean_query_field` / LRCLIB / NetEase tolerance never reached
// affected tracks (#67 APT/ROSÉ + the user-reported "wrong lyrics on
// the current playing song" 2026-04-26). Bumping to v3 forces every
// track to re-fetch once with the current matcher; the old v2 hits
// orphan in localStorage and are reclaimable via the storage cap.
//
// (v2 bump (earlier 2026-04-26): the v1 misses cache stored a 14-day
// "no lyrics" verdict for tracks where YTM's audio counterpart
// returned empty — a false negative for many regular tracks. The
// lyrics flow today re-routes to LRCLIB+NetEase whenever the title
// doesn't look like an instrumental, so the v1 misses had to be
// invalidated.)
const HITS_KEY = 'vibeytm:lyrics:v3:hits';
const MISSES_KEY = 'vibeytm:lyrics:v3:misses';
const FAILURES_KEY = 'vibeytm:lyrics:v3:failures';
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

/**
 * Forget every cached judgement (hit, miss, failure-cooldown, in-flight)
 * for `videoId` so the next `useLyrics(...)` consumer triggers a fresh
 * fetch. ALSO calls the Rust `invalidate_lyrics_cache` IPC so the disk-
 * side cache is wiped — without that step, the FE re-fetch lands on
 * the Rust handler which short-circuits on its own cache and returns
 * the same stale result.
 *
 * Used by the "Refresh lyrics" affordance in the lyric panel: when the
 * matcher returned wrong lyrics in an earlier session, both caches keep
 * serving the wrong result indefinitely until manually invalidated.
 */
export async function invalidateLyrics(videoId: string): Promise<void> {
  if (!videoId) return;
  lyricsCache.delete(videoId);
  lyricsMisses.delete(videoId);
  inFlight.delete(videoId);
  try {
    const hits = readJson<Record<string, Lyrics>>(HITS_KEY, {});
    if (videoId in hits) {
      delete hits[videoId];
      writeJson(HITS_KEY, hits);
    }
    const misses = readJson<Record<string, number>>(MISSES_KEY, {});
    if (videoId in misses) {
      delete misses[videoId];
      writeJson(MISSES_KEY, misses);
    }
    const failures = readJson<Record<string, number>>(FAILURES_KEY, {});
    if (videoId in failures) {
      delete failures[videoId];
      writeJson(FAILURES_KEY, failures);
    }
  } catch {
    // Best-effort — localStorage failures don't block the disk-side wipe.
  }
  try {
    await browseApi.invalidateLyricsCache(videoId);
  } catch {
    // Even if the IPC fails, the FE already forgot; the next fetch will
    // hit Rust which serves whatever's in its cache. The user can click
    // refresh again.
  }
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

/** Loose case-insensitive substring match in either direction. Mirrors
 *  the Rust `lyric_field_matches` so the BE and FE caches reach the same
 *  verdict on a given `(cached, request)` pair. */
function lyricFieldMatches(a: string, b: string): boolean {
  const al = a.trim().toLowerCase();
  const bl = b.trim().toLowerCase();
  if (!al || !bl) return false;
  return al.includes(bl) || bl.includes(al);
}

/** Cache-read sanity check: returns true when the cached `Lyrics` entry
 *  is still valid for the requested artist/title. Pre-stamping entries
 *  (no `matchedArtist`/`matchedTitle`) are trusted. Both fields must
 *  loosely agree — title-only OR artist-only matches were the exact
 *  failure mode that produced the wrong-song lyrics regression. */
function cachedLyricsMatchesRequest(
  cached: Lyrics,
  requestArtist: string | null | undefined,
  requestTitle: string | null | undefined,
): boolean {
  const cachedArtist = cached.matchedArtist?.trim() ?? '';
  const cachedTitle = cached.matchedTitle?.trim() ?? '';
  if (!cachedArtist || !cachedTitle) {
    return true; // pre-stamping entry — trust it
  }
  return (
    lyricFieldMatches(cachedArtist, requestArtist ?? '') &&
    lyricFieldMatches(cachedTitle, requestTitle ?? '')
  );
}

/** Drop the cache entries for a videoId in-process. Called by the cache-
 *  read sanity check when a stale-mismatch is detected so the next
 *  consumer sees the entry as missing and triggers a fresh fetch. The
 *  matching disk-side eviction happens in the BE handler. */
function dropFrontendLyricsCache(videoId: string): void {
  lyricsCache.delete(videoId);
  inFlight.delete(videoId);
  try {
    const hits = readJson<Record<string, Lyrics>>(HITS_KEY, {});
    if (videoId in hits) {
      delete hits[videoId];
      writeJson(HITS_KEY, hits);
    }
  } catch {
    /* best-effort */
  }
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

async function fetchOnce(lookup: LyricsLookup, forceExternal: boolean) {
  return browseApi.getLyrics({
    videoId: lookup.videoId,
    artist: lookup.artist ?? null,
    title: lookup.title ?? null,
    durationSecs: lookup.durationSecs ?? null,
    forceExternal,
  });
}

function ensureFetch(lookup: LyricsLookup, forceExternal = false): Promise<void> {
  const { videoId } = lookup;
  // Sanity check before serving from the in-memory hit cache: a stale
  // entry from an earlier session may have matched the wrong song. When
  // the artist/title metadata diverges, treat it as a miss and let the
  // fetch path reach Rust (which also re-verifies the disk cache).
  const hit = lyricsCache.get(videoId);
  if (hit && !cachedLyricsMatchesRequest(hit, lookup.artist, lookup.title)) {
    dropFrontendLyricsCache(videoId);
  } else if (hit) {
    return Promise.resolve();
  }
  if (lyricsMisses.has(videoId)) {
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
      const result = await fetchOnce(lookup, forceExternal);
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
  /** Bump-counter the consumer can increment to force the effect to re-run
   *  even when videoId / lookup metadata is unchanged. Used by the lyric
   *  panel's "Refresh" affordance: after `invalidateLyrics(videoId)` the
   *  caches are clear, but the effect's deps haven't changed — so without
   *  this knob the next render returns the now-empty `loading` state but
   *  never actually re-fetches. */
  refetchEpoch = 0,
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
    // Sanity check the in-memory hit before short-circuiting. When a
    // previous session matched the wrong song's lyrics to this videoId
    // (e.g. NetEase's loose title-substring search), the cached entry's
    // stamped artist/title diverges from the request — drop it and let
    // the fetch path run.
    const hit = lyricsCache.get(videoId);
    if (hit && !cachedLyricsMatchesRequest(hit, artist, title)) {
      dropFrontendLyricsCache(videoId);
      // Also drop the disk-cache entry so the imminent fetch reaches
      // the live LRCLIB/NetEase race instead of getting served the
      // same stale Rust-side cached lie.
      void browseApi.invalidateLyricsCache(videoId).catch(() => {});
    } else if (hit || lyricsMisses.has(videoId)) {
      return;
    }

    let cancelled = false;

    // Any non-zero `refetchEpoch` is the consumer telling us "the
    // previous result was wrong, please try harder" — pass that signal
    // through to Rust as `forceExternal=true` so we bypass YTM's own
    // (sometimes wrong) synced-lyrics tab and race LRCLIB/NetEase. The
    // initial mount uses epoch=0 → normal flow.
    const isRefreshRun = refetchEpoch > 0;

    const run = () => {
      if (cancelled) return;
      ensureFetch(
        { videoId, artist, title, durationSecs: duration },
        isRefreshRun,
      ).then(() => {
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
  }, [videoId, enabled, immediate, artist, title, duration, refetchEpoch]);

  if (!videoId) {
    return { status: 'idle', lyrics: null, error: null };
  }
  const hit = lyricsCache.get(videoId);
  if (hit) {
    // Don't surface a stale-mismatched hit. The useEffect above already
    // scheduled a re-fetch; render `loading` until it completes so the
    // UI doesn't briefly flash the wrong song's lyrics.
    if (cachedLyricsMatchesRequest(hit, artist, title)) {
      return { status: 'available', lyrics: hit, error: null };
    }
    return { status: 'loading', lyrics: null, error: null };
  }
  if (lyricsMisses.has(videoId)) {
    return { status: 'missing', lyrics: null, error: lyricsMisses.get(videoId) ?? null };
  }
  return { status: 'loading', lyrics: null, error: null };
}
