import { useEffect, useState } from 'react';
import { browseApi } from '../lib/ipc';

// Module-level cache keyed by videoId so concurrent components
// (PlayerBar + NowPlaying + QueuePanel's now-playing row) share a
// single IPC fetch per track. Keeping it module-scoped means the
// result also survives unmount/remount cycles within a session.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/**
 * For tracks that have both a music-video and audio counterpart on
 * YouTube Music, returns the audio counterpart's album-art URL —
 * the square `lh*.googleusercontent.com` cover, NOT the music
 * video's 16:9 frame. Returns `fallback` (typically the bridge's
 * captured `track.artworkUrl`) until the lookup resolves, and
 * permanently if the track has no counterpart.
 *
 * Why this exists: the YTM bridge's `fetchPlayerState()` reads
 * `<ytmusic-player-page img.thumbnail-image>`, which on a music-
 * video page is the 16:9 video frame. The audio counterpart's
 * album cover lives in the /next response under
 * `playlistPanelVideoWrapperRenderer.counterpartRenderer`. This
 * hook fetches that data lazily on track change and caches the
 * result so subsequent renders are free.
 */
export function useAudioCounterpartArtwork(
  videoId: string | undefined | null,
  fallback: string | undefined | null,
): string | undefined {
  // Track BOTH the videoId we last produced an `override` for AND the
  // `override` itself in a single state object. When `videoId` changes
  // we derive a fresh value SYNCHRONOUSLY during render — without
  // this, the previous track's override would linger on screen until
  // the new track's IPC resolves (commonly 0.5-2 s, longer on bridge
  // saturation). React's "derive state from props during render"
  // pattern: re-set state during render and React schedules a
  // re-render with the new value before commit.
  const [state, setState] = useState<{
    videoId: string | undefined | null;
    override: string | null;
  }>(() => ({
    videoId,
    override: videoId && cache.has(videoId) ? cache.get(videoId) ?? null : null,
  }));
  if (state.videoId !== videoId) {
    setState({
      videoId,
      override: videoId && cache.has(videoId) ? cache.get(videoId) ?? null : null,
    });
  }

  useEffect(() => {
    if (!videoId) return;
    if (cache.has(videoId)) return;

    let cancelled = false;
    const existing = inflight.get(videoId);
    // Distinguish a SUCCESSFUL "no counterpart" (Rust resolves Ok(None) →
    // JS resolves null) from a TRANSIENT IPC FAILURE (rejected). Only
    // the former is cached as null — failures need to remain retryable
    // so a single bridge timeout doesn't leave the video thumbnail
    // stuck on the player bar forever.
    const fetchSentinel = Symbol('fetchFailed') as unknown as string;
    const promise: Promise<string | null | typeof fetchSentinel> =
      existing ??
      browseApi
        .getAudioCounterpartArtwork(videoId)
        .catch(() => fetchSentinel);
    if (!existing) inflight.set(videoId, promise);

    promise.then((result) => {
      inflight.delete(videoId);
      if (result === fetchSentinel) {
        // Transient failure (IPC error, bridge timeout, etc.). Do
        // NOT cache — the next render that needs this videoId
        // should retry from scratch. The user is left with the
        // fallback (video thumbnail) until then; better than
        // pinning it forever.
        return;
      }
      const url = result as string | null;
      cache.set(videoId, url);
      if (cancelled) return;
      // Only commit if the player is still on this videoId — a skip
      // mid-fetch makes the result stale and we don't want to flash
      // the previous track's cover onto the new one.
      setState((prev) =>
        prev.videoId === videoId ? { videoId, override: url } : prev,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  return state.override ?? fallback ?? undefined;
}
