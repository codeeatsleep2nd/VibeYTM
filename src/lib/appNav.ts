/**
 * App-level navigation hooks exposed as a tiny module-level registry.
 * Components that need to drive top-level nav (e.g. a track-row context
 * menu opening the artist page) read the current handler here without
 * prop-drilling through every shelf, row, and detail page.
 *
 * `App` registers handlers once on mount; consumers grab them via the
 * `getX` accessors at the moment the user clicks. Never cache the
 * accessor's return — the registry can be replaced (HMR, future
 * router refactor) and stale closures would break navigation.
 */

type ArtistNavHandler = (artistName: string) => void;

let openArtistHandler: ArtistNavHandler | null = null;

export function registerOpenArtist(handler: ArtistNavHandler | null): void {
  openArtistHandler = handler;
}

export function openArtist(artistName: string): void {
  openArtistHandler?.(artistName);
}

export function hasOpenArtistHandler(): boolean {
  return openArtistHandler !== null;
}
