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
  const [override, setOverride] = useState<string | null>(() =>
    videoId && cache.has(videoId) ? cache.get(videoId)! : null,
  );

  useEffect(() => {
    if (!videoId) {
      setOverride(null);
      return;
    }
    if (cache.has(videoId)) {
      setOverride(cache.get(videoId)!);
      return;
    }
    let cancelled = false;
    const existing = inflight.get(videoId);
    const promise =
      existing ??
      browseApi.getAudioCounterpartArtwork(videoId).catch(() => null);
    if (!existing) inflight.set(videoId, promise);

    promise.then((url) => {
      cache.set(videoId, url ?? null);
      inflight.delete(videoId);
      if (cancelled) return;
      setOverride(url ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  return override ?? fallback ?? undefined;
}
