// Cross-component cache mapping `videoId → album-art URL`.
//
// The /next endpoint only returns ~2-3 wrapper entries per call;
// liveQueue (DOM scrape) sees the full queue but with i.ytimg video
// thumbnails that the "no video thumbnails" rule filters out. The
// playlist-detail page, in contrast, has proper lh*.googleusercontent.com
// album art for every track. Routing those through this registry
// lets the queue panel reuse them when the user is playing from a
// playlist they've recently visited.
//
// In-memory only — entries last for the session. Cheap; only stores
// strings keyed by 11-char videoIds.

import type { TrackInfo } from './types';

const registry = new Map<string, string>();

function isAlbumArt(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\/(?:lh\d+|yt3)\.googleusercontent\.com\//.test(url);
}

/** Insert/overwrite the artwork URL for a single videoId, only if it's
 *  album art (filters out video thumbnails to keep the registry clean). */
export function rememberTrackArtwork(
  videoId: string | null | undefined,
  artworkUrl: string | null | undefined,
): void {
  if (!videoId || !isAlbumArt(artworkUrl)) return;
  registry.set(videoId, artworkUrl as string);
}

/** Bulk-insert from a list of TrackInfo. Use after fetching playlist
 *  details, library listings, search results — any source that
 *  carries clean album-art URLs alongside videoIds. */
export function rememberTrackArtworks(tracks: ReadonlyArray<TrackInfo>): void {
  for (const t of tracks) {
    rememberTrackArtwork(t.videoId, t.artworkUrl);
  }
}

export function lookupTrackArtwork(videoId: string | null | undefined): string | undefined {
  if (!videoId) return undefined;
  return registry.get(videoId);
}
