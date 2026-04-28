// Side-channel for per-track metadata (title + artist), keyed by videoId.
//
// Why this exists:
//   The bridge JS scrapes the YTM queue via `.song-title` / `.byline`
//   selectors that match SONG queue items but NOT podcast / show
//   episode queue items (those use a different DOM shape). Episode
//   rows therefore arrive in PlayerState's queue with empty `title`
//   and `artist`, and `<QueueRow>` shows "Unknown title" with no
//   byline.
//
//   `PlaylistDetailPage` already fetches the show's full episode list
//   via `parse_playlist_detail` (which uses `parse_episode_from_multi_row`
//   for episodes) — that data has proper episode title + show-name
//   artist for each row. Stashing it here lets the queue surface
//   recover the correct text without reaching back through Rust.
//
// In-memory only — entries last for the session.

import type { TrackInfo } from './types';

interface Meta {
  title: string;
  artist: string;
}

const registry = new Map<string, Meta>();

export function rememberTrackMeta(
  videoId: string | null | undefined,
  title: string | null | undefined,
  artist: string | null | undefined,
): void {
  if (!videoId) return;
  // Only insert when we have at least a non-empty title — that's the
  // load-bearing field for the queue row (artist can legitimately be
  // empty on some sources; title can't).
  const safeTitle = (title ?? '').trim();
  if (!safeTitle) return;
  registry.set(videoId, {
    title: safeTitle,
    artist: (artist ?? '').trim(),
  });
}

export function rememberTrackMetas(tracks: ReadonlyArray<TrackInfo>): void {
  for (const t of tracks) {
    rememberTrackMeta(t.videoId, t.title, t.artist);
  }
}

export function lookupTrackMeta(
  videoId: string | null | undefined,
): Meta | undefined {
  if (!videoId) return undefined;
  return registry.get(videoId);
}
