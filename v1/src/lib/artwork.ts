// Helpers for distinguishing album art (square song cover) from
// YouTube video thumbnails (16:9 frames). The user-facing rule is:
// **NEVER show a video thumbnail anywhere.** If we don't have album
// art for a track, show a placeholder instead of falling back to the
// video frame. The audio counterpart from YTM's /next response is
// the canonical source — see useAudioCounterpartArtwork hook.

/**
 * True iff `url` points to YouTube's album-art CDN
 * (`lh*.googleusercontent.com` or `yt3.googleusercontent.com`).
 * Signed and unsigned URLs both qualify — the signature only affects
 * expiry, not which image is rendered.
 *
 * False for `i.ytimg.com/vi/...` (the YouTube *video* thumbnail
 * service) and any unknown host.
 */
export function isAlbumArtUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (/^https?:\/\/lh\d+\.googleusercontent\.com\//.test(url)) return true;
  if (/^https?:\/\/yt3\.googleusercontent\.com\//.test(url)) return true;
  return false;
}

/**
 * Return `url` only if it's album art; otherwise undefined.
 * Convenience wrapper for callers that want to drop video thumbnails
 * silently.
 */
export function albumArtOrNothing(
  url: string | null | undefined,
): string | undefined {
  return isAlbumArtUrl(url) ? (url as string) : undefined;
}
