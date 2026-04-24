import { useEffect, useState } from 'react';
import { browseApi } from '../lib/ipc';
import type { Lyrics } from '../lib/types';

// Shared caches — a Map for hits and a Map for confirmed misses so the UI
// can instantly render both states without re-hitting YTM. A pending
// Promise map de-duplicates concurrent fetches from PlayerBar + NowPlaying.
//
// Transient errors (webview mid-navigation, timeouts, bridge glitches) are
// NOT cached — otherwise a track change that happens to race the probe
// would permanently disable the lyrics button for that video.
const lyricsCache = new Map<string, Lyrics>();
const lyricsMisses = new Map<string, string | null>();
const inFlight = new Map<string, Promise<void>>();

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
  const existing = inFlight.get(videoId);
  if (existing) return existing;

  // Try immediately, then once more after ~1.5 s if the first attempt
  // throws. That covers the most common failure mode: an eager probe
  // firing while YTM's webview is still navigating to the new track.
  // Eventual "YTM says no lyrics" results STILL cache a miss; only
  // transport/JS-bridge errors retry.
  const runOnce = async (): Promise<'ok' | 'empty' | 'error'> => {
    try {
      const result = await fetchOnce(lookup);
      if (hasContent(result)) {
        lyricsCache.set(videoId, result);
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
      return;
    }
    // Transient error: wait and retry once.
    await new Promise((r) => setTimeout(r, 1500));
    const second = await runOnce();
    if (second === 'empty') {
      lyricsMisses.set(videoId, null);
    }
    // On second error, leave the track un-cached so a future call retries.
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
