// Side-channel for podcast / show cover URLs, keyed by the show's MPSP*
// browseId. Populated by PlaylistDetailPage whenever the user opens an
// MPSP playlist; consulted by the now-playing Cover when the active
// playlist context is a show.
//
// Why this exists rather than using `trackArtworkRegistry`:
//   - The track-artwork registry is keyed per videoId AND filters URLs
//     down to `lh*|yt3.googleusercontent.com`. Show channel covers are
//     sometimes served from other hosts (e.g. `youtube-podcasts-
//     ingestion-proxy`, `i.ytimg.com/sb/...`), so the strict filter
//     drops them silently and the playing page loses the fallback.
//   - The channel-page hero renders the show cover via `<CachedImage>`
//     with NO host filter — the same URL we want on the playing page.
//     This registry stores that URL directly without further checks.
//
// In-memory only — entries last for the session. One entry per show.

const registry = new Map<string, string>();

export function rememberShowCover(
  playlistId: string | null | undefined,
  url: string | null | undefined,
): void {
  if (!playlistId || !url) return;
  if (!playlistId.startsWith('MPSP')) return;
  registry.set(playlistId, url);
}

export function lookupShowCover(
  playlistId: string | null | undefined,
): string | undefined {
  if (!playlistId) return undefined;
  return registry.get(playlistId);
}
