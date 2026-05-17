import { isAlbumArtUrl } from '../../../lib/artwork';

/**
 * Build an ordered list of album-art URL fallbacks for a queue row.
 *
 * **The user-facing rule: NEVER fall back to a YouTube video thumbnail
 * (`i.ytimg.com/vi/...`).** The chain only contains album art
 * (`lh*.googleusercontent.com` / `yt3.googleusercontent.com`). If we
 * have nothing, the row renders `<ArtworkPlaceholder>` (a music-note
 * glyph on a dark gradient) — that reads as "no cover yet" rather than
 * "wrong image."
 */
export { isAlbumArtUrl };

// Re-exported here for the existing test suite (and any future caller
// that wants the broader name). Kept narrow on purpose: the ONLY URLs
// we'll ever show are album art.
export function isStableArtworkUrl(url: string | null | undefined): boolean {
  return isAlbumArtUrl(url);
}

export function artworkChain(track: {
  videoId?: string;
  artworkUrl?: string | null;
}): string[] {
  if (isAlbumArtUrl(track.artworkUrl)) {
    return [track.artworkUrl as string];
  }
  return [];
}
