import { useEffect, useState } from 'react';
import { browseApi } from '../lib/ipc';
import { isAlbumArtUrl } from '../lib/artwork';
import { debug } from '../lib/debug';

// Issue #65 — UGC cover-art fallback. When the YTM bridge captures a
// video thumbnail (filtered out by `isAlbumArtUrl`) AND there's no
// audio counterpart artwork (UGC tracks have none), fetch a real
// album cover from iTunes Search via the new `get_external_cover_art`
// IPC and use that. Module-level cache keyed by videoId so concurrent
// components share one IPC fetch and the result survives unmount.

const cache = new Map<string, string | null>();
// Per-videoId failure marker. CLAUDE.md mandates that any
// background fetch on track-change should be idempotent and bounded
// — without this set, a transient iTunes outage retried on every
// re-render of the hook (the deps include artist/title/durationSecs
// which YTM's bridge refines after the initial track-changed emit).
// One miss per videoId per session is the contract; user can force
// a retry by skipping away and back, which clears the in-memory state.
const failedVideoIds = new Set<string>();

const FETCH_FAILED: unique symbol = Symbol('vibeytm:externalCoverFetchFailed');
type FetchResult = string | null | typeof FETCH_FAILED;
const inflight = new Map<string, Promise<FetchResult>>();

// Settle delay before firing the iTunes IPC after a track change.
// Per the CLAUDE.md "background fetches need a settle delay" rule —
// YTM's hidden audio webview navigates on every track change and the
// bridge channel hangs for ~3-15 s during the transition. Firing
// straight away piles onto the stuck channel and starves user-driven
// IPCs (`get_playlist`, `search`) that the user is clicking right
// then. 1.5 s matches the documented value.
const TRACK_CHANGE_SETTLE_MS = 1500;

interface CoverFallbackInput {
  videoId: string | undefined | null;
  artist: string | undefined | null;
  title: string | undefined | null;
  durationSecs: number | undefined | null;
  /** What the YTM bridge captured (or the audio counterpart). When
   *  this is already an album-art URL, we DO NOT call the external
   *  source — the existing path is good enough. The hook returns
   *  `undefined` in that case so the caller's existing chain still
   *  wins. */
  bridgeArtworkUrl: string | undefined | null;
}

/**
 * Returns an external album-cover URL (Apple Music) when:
 *   1. We have a videoId + artist + title to query on, AND
 *   2. The bridge / counterpart artwork is missing or is a YouTube
 *      video thumbnail (rejected by `isAlbumArtUrl`).
 *
 * Returns `undefined` while the lookup is pending OR when the existing
 * artwork is already a real album cover. Never returns a stale result
 * across track changes — the latest videoId's resolution wins.
 */
export function useExternalCoverFallback(
  input: CoverFallbackInput,
): string | undefined {
  const { videoId, artist, title, durationSecs, bridgeArtworkUrl } = input;

  // If the bridge gave us a real album-art URL, the fallback is not
  // needed — short-circuit so we never even fire the IPC.
  const fallbackNeeded = !!videoId
    && !!artist
    && !!title
    && !isAlbumArtUrl(bridgeArtworkUrl ?? undefined);

  const [state, setState] = useState<{
    videoId: string | undefined | null;
    override: string | null;
  }>(() => ({
    videoId,
    override:
      videoId && cache.has(videoId) ? cache.get(videoId) ?? null : null,
  }));

  if (state.videoId !== videoId) {
    setState({
      videoId,
      override:
        videoId && cache.has(videoId) ? cache.get(videoId) ?? null : null,
    });
  }

  useEffect(() => {
    if (!fallbackNeeded || !videoId) return;
    if (cache.has(videoId)) return;
    // Don't retry within the same session if a previous attempt failed.
    // Without this guard a transient iTunes outage was hit again every
    // time the bridge refined artist/title/durationSecs (which retrigger
    // this effect through the dep array).
    if (failedVideoIds.has(videoId)) return;

    let cancelled = false;
    // Track-change settle delay. The IPC fires only after a 1.5 s
    // window with no further dep changes — debouncing artist/title/
    // duration refinements that YTM emits during the transition.
    // Cleanup clears the timer if the videoId changes mid-wait, so we
    // never fire for a track the user has already skipped.
    const fireTimer = setTimeout(() => {
      if (cancelled) return;
      // Re-check the cache inside the timer in case a sibling component
      // populated it during the settle window.
      if (cache.has(videoId)) return;
      // The bridge can briefly emit `durationSecs: 0` before YTM's
      // <video> metadata loads. A `0` duration would force the iTunes
      // candidate filter to reject every real-length track. Coerce to
      // null so the Rust side skips duration filtering instead.
      const safeDuration =
        durationSecs && durationSecs > 0 ? durationSecs : null;
      const existing = inflight.get(videoId);
      const promise: Promise<FetchResult> =
        existing
        ?? browseApi
          .getExternalCoverArt({
            artist: artist!,
            title: title!,
            durationSecs: safeDuration,
          })
          .catch((): FetchResult => FETCH_FAILED);
      if (!existing) inflight.set(videoId, promise);

      promise.then((result) => {
        inflight.delete(videoId);
        if (result === FETCH_FAILED) {
          debug.warn('useExternalCoverFallback', 'IPC failed', { videoId });
          // Mark this videoId as terminally-failed for the session so
          // dep-array re-fires don't replay the request.
          failedVideoIds.add(videoId);
          return;
        }
        cache.set(videoId, result);
        debug.log('useExternalCoverFallback', 'IPC resolved', {
          videoId,
          hasUrl: !!result,
        });
        if (cancelled) return;
        setState((prev) =>
          prev.videoId === videoId ? { videoId, override: result } : prev,
        );
      });
    }, TRACK_CHANGE_SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(fireTimer);
    };
  }, [videoId, artist, title, durationSecs, fallbackNeeded]);

  return state.override ?? undefined;
}
