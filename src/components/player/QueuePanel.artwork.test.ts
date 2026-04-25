import { describe, expect, it } from 'vitest';
import { artworkChain, isAlbumArtUrl, isStableArtworkUrl } from './QueuePanel';

describe('isAlbumArtUrl', () => {
  it('matches any lh*.googleusercontent.com host', () => {
    expect(isAlbumArtUrl('https://lh3.googleusercontent.com/abc=w512-h512')).toBe(true);
    expect(isAlbumArtUrl('https://lh4.googleusercontent.com/abc')).toBe(true);
    expect(isAlbumArtUrl('https://lh5.googleusercontent.com/abc')).toBe(true);
  });

  it('matches yt3.googleusercontent.com (artist avatar / channel banner CDN)', () => {
    expect(isAlbumArtUrl('https://yt3.googleusercontent.com/abc=w512-h512')).toBe(true);
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
    expect(isAlbumArtUrl('https://i.ytimg.com/vi/abc/sddefault.jpg?sqp=foo&rs=bar')).toBe(false);
    expect(isAlbumArtUrl('https://example.com/image.jpg')).toBe(false);
    expect(isAlbumArtUrl(null)).toBe(false);
    expect(isAlbumArtUrl('')).toBe(false);
  });
});

describe('isStableArtworkUrl', () => {
  // After the "never show video thumbnails" rule, stable === albumArt.
  it('is now an alias for isAlbumArtUrl', () => {
    expect(isStableArtworkUrl('https://lh3.googleusercontent.com/abc')).toBe(true);
    expect(isStableArtworkUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(false);
    expect(isStableArtworkUrl(null)).toBe(false);
  });
});

describe('artworkChain', () => {
  it('returns empty when no artworkUrl', () => {
    expect(artworkChain({})).toEqual([]);
    expect(artworkChain({ videoId: 'abc' })).toEqual([]);
  });

  it('returns the album-art URL when present (signed or unsigned)', () => {
    const unsigned = 'https://lh3.googleusercontent.com/EwM=w512-h512-l90-rj';
    expect(artworkChain({ videoId: 'x', artworkUrl: unsigned })).toEqual([unsigned]);

    const signed = 'https://lh3.googleusercontent.com/EwM=w512-h512?sqp=foo&rs=bar';
    expect(artworkChain({ videoId: 'x', artworkUrl: signed })).toEqual([signed]);
  });

  it('NEVER returns a YouTube video thumbnail URL', () => {
    // The "video thumbnail by videoId" tier is gone. The user-facing
    // rule is to render <ArtworkPlaceholder> instead of falling back
    // to i.ytimg.com/vi/...
    const signedVideo =
      'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=-oaymw&rs=AMzJL3kabc';
    expect(artworkChain({ videoId: 'x', artworkUrl: signedVideo })).toEqual([]);
    expect(artworkChain({ videoId: 'x' })).toEqual([]);
  });

  it('returns just the album URL when no videoId provided', () => {
    const album = 'https://lh3.googleusercontent.com/abc=w512-h512';
    expect(artworkChain({ artworkUrl: album })).toEqual([album]);
  });
});
