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

const FETCH_FAILED: unique symbol = Symbol('vibeytm:externalCoverFetchFailed');
type FetchResult = string | null | typeof FETCH_FAILED;
const inflight = new Map<string, Promise<FetchResult>>();

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

    let cancelled = false;
    const existing = inflight.get(videoId);
    const promise: Promise<FetchResult> =
      existing
      ?? browseApi
        .getExternalCoverArt({
          artist: artist!,
          title: title!,
          durationSecs: durationSecs ?? null,
        })
        .catch((): FetchResult => FETCH_FAILED);
    if (!existing) inflight.set(videoId, promise);

    promise.then((result) => {
      inflight.delete(videoId);
      if (result === FETCH_FAILED) {
        debug.warn('useExternalCoverFallback', 'IPC failed', { videoId });
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

    return () => {
      cancelled = true;
    };
  }, [videoId, artist, title, durationSecs, fallbackNeeded]);

  return state.override ?? undefined;
}
