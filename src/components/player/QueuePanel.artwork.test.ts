import { describe, expect, it } from 'vitest';
import { artworkChain, isAlbumArtUrl, isStableArtworkUrl } from './QueuePanel';

describe('isAlbumArtUrl', () => {
  it('matches any lh*.googleusercontent.com host', () => {
    expect(isAlbumArtUrl('https://lh3.googleusercontent.com/abc=w512-h512')).toBe(true);
    expect(isAlbumArtUrl('https://lh4.googleusercontent.com/abc')).toBe(true);
    expect(isAlbumArtUrl('https://lh5.googleusercontent.com/abc')).toBe(true);
  });

  it('matches signed album-art URLs too — they are still album art', () => {
    expect(
      isAlbumArtUrl(
        'https://lh3.googleusercontent.com/abc=w512-h512?sqp=foo&rs=bar',
      ),
    ).toBe(true);
  });

  it('returns false for video CDN and unknown hosts', () => {
    expect(isAlbumArtUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(false);
    expect(isAlbumArtUrl('https://example.com/image.jpg')).toBe(false);
    expect(isAlbumArtUrl(null)).toBe(false);
    expect(isAlbumArtUrl('')).toBe(false);
  });
});

describe('isStableArtworkUrl', () => {
  it('returns false for null / undefined / empty', () => {
    expect(isStableArtworkUrl(null)).toBe(false);
    expect(isStableArtworkUrl(undefined)).toBe(false);
    expect(isStableArtworkUrl('')).toBe(false);
  });

  it('accepts album-art URLs from googleusercontent (no signature)', () => {
    expect(
      isStableArtworkUrl(
        'https://lh3.googleusercontent.com/EwM3POsnGgai7udLpEDLsDt1=w512-h512-l90-rj',
      ),
    ).toBe(true);
    expect(
      isStableArtworkUrl(
        'https://lh4.googleusercontent.com/abc=w256-h256',
      ),
    ).toBe(true);
  });

  it('accepts SIGNED album-art URLs (lh* host) — still album art', () => {
    expect(
      isStableArtworkUrl(
        'https://lh3.googleusercontent.com/abc=w512-h512?sqp=foo&rs=bar',
      ),
    ).toBe(true);
  });

  it('rejects signed YouTube video CDN URLs (sqp= or rs= present)', () => {
    expect(
      isStableArtworkUrl(
        'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=-oaymw&rs=AMzJL3kabc',
      ),
    ).toBe(false);
  });

  it('accepts plain i.ytimg.com video CDN paths without query strings', () => {
    expect(
      isStableArtworkUrl('https://i.ytimg.com/vi/abc123/hqdefault.jpg'),
    ).toBe(true);
  });

  it('rejects unknown hosts to be safe', () => {
    expect(isStableArtworkUrl('https://example.com/image.jpg')).toBe(false);
    expect(isStableArtworkUrl('http://malicious.example/cover.png')).toBe(
      false,
    );
  });
});

describe('artworkChain', () => {
  it('returns empty when no videoId and no artworkUrl', () => {
    expect(artworkChain({})).toEqual([]);
  });

  it('returns the videoId fallback chain when artworkUrl is missing', () => {
    expect(artworkChain({ videoId: 'abc123' })).toEqual([
      'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
      'https://i.ytimg.com/vi/abc123/default.jpg',
      'https://i.ytimg.com/vi/abc123/0.jpg',
    ]);
  });

  it('puts album-art URL FIRST when present (signed or unsigned)', () => {
    const unsignedAlbum = 'https://lh3.googleusercontent.com/EwM=w512-h512-l90-rj';
    expect(
      artworkChain({ videoId: 'abc123', artworkUrl: unsignedAlbum })[0],
    ).toBe(unsignedAlbum);

    const signedAlbum =
      'https://lh3.googleusercontent.com/EwM=w512-h512?sqp=foo&rs=bar';
    expect(
      artworkChain({ videoId: 'abc123', artworkUrl: signedAlbum })[0],
    ).toBe(signedAlbum);
  });

  it('falls back to video-thumbnail chain when artworkUrl is a signed VIDEO CDN URL', () => {
    // Signed video-CDN URLs expire too fast to be worth trying first;
    // skip them and go straight to the canonical video thumbnail.
    const signedVideo =
      'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=-oaymw&rs=AMzJL3kabc';
    expect(artworkChain({ videoId: 'abc123', artworkUrl: signedVideo })).toEqual([
      'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
      'https://i.ytimg.com/vi/abc123/default.jpg',
      'https://i.ytimg.com/vi/abc123/0.jpg',
    ]);
  });

  it('places album art before any video thumbnail (the user-facing rule)', () => {
    const album = 'https://lh3.googleusercontent.com/abc=w512-h512';
    const chain = artworkChain({ videoId: 'abc123', artworkUrl: album });
    const albumIdx = chain.indexOf(album);
    const firstVideoThumb = chain.findIndex((u) =>
      u.startsWith('https://i.ytimg.com/vi/'),
    );
    expect(albumIdx).toBeGreaterThanOrEqual(0);
    expect(firstVideoThumb).toBeGreaterThan(albumIdx);
  });

  it('returns just the album URL when no videoId provided', () => {
    const album = 'https://lh3.googleusercontent.com/abc=w512-h512';
    expect(artworkChain({ artworkUrl: album })).toEqual([album]);
  });

  it('does not duplicate an artworkUrl that matches a videoId fallback', () => {
    const dupe = 'https://i.ytimg.com/vi/abc123/hqdefault.jpg';
    const chain = artworkChain({ videoId: 'abc123', artworkUrl: dupe });
    expect(chain.filter((u) => u === dupe)).toHaveLength(1);
  });
});
