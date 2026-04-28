// Helpers for distinguishing album art (square song cover) from
// YouTube video thumbnails (16:9 frames). The user-facing rule is:
// **NEVER show a video thumbnail anywhere.** If we don't have album
// art for a track, show a placeholder instead of falling back to the
// video frame. The audio counterpart from YTM's /next response is
// the canonical source — see useAudioCounterpartArtwork hook.

/**
 * True iff `url` points to a known album-art CDN:
 *   - `lh*.googleusercontent.com` / `yt3.googleusercontent.com` —
 *     YouTube Music's own album covers.
 *   - `is*-ssl.mzstatic.com` — Apple Music CDN, used by the issue
 *     #65 UGC fallback (`useExternalCoverFallback`). Without this the
 *     hook's `fallbackNeeded` check classified its OWN cached result
 *     as "not album art", causing redundant lookups when the result
 *     happened to flow back through the chain as a bridge artwork.
 *
 * Signed and unsigned URLs both qualify for the YouTube CDNs — the
 * signature only affects expiry, not which image is rendered.
 *
 * False for `i.ytimg.com/vi/...` (the YouTube *video* thumbnail
 * service) and any unknown host.
 */
export function isAlbumArtUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (/^https?:\/\/lh\d+\.googleusercontent\.com\//.test(url)) return true;
  if (/^https?:\/\/yt3\.googleusercontent\.com\//.test(url)) return true;
  if (/^https?:\/\/is\d+-ssl\.mzstatic\.com\//.test(url)) return true;
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
