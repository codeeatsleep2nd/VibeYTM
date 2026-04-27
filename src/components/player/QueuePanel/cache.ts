import type { TrackInfo } from '../../../lib/types';

/**
 * Module-level cache keyed by `<videoId>|<playlistId>` so reopening the
 * panel for a (track, playlist) pair we've already fetched is instant.
 * Lives outside the component so the cache survives close+reopen of the
 * drawer and remounts during HMR / sidebar nav.
 */
export const queueCache = new Map<string, TrackInfo[]>();

export const cacheKey = (
  videoId: string | undefined,
  playlistId: string | null,
): string => `${videoId ?? ''}|${playlistId ?? ''}`;

/** How many upcoming tracks we ask YTM's `/next` endpoint to return. */
export const UPCOMING_LIMIT = 100;
