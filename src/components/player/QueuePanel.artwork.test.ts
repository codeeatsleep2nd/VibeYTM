import { describe, expect, it } from 'vitest';
import { artworkChain, isStableArtworkUrl } from './QueuePanel';

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

  it('rejects signed YouTube CDN URLs (sqp= or rs= present)', () => {
    expect(
      isStableArtworkUrl(
        'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=-oaymw&rs=AMzJL3kabc',
      ),
    ).toBe(false);
    expect(
      isStableArtworkUrl(
        'https://lh3.googleusercontent.com/abc=w512-h512?sqp=foo&rs=bar',
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

  it('puts a stable album-art URL FIRST when present', () => {
    const album = 'https://lh3.googleusercontent.com/EwM=w512-h512-l90-rj';
    const chain = artworkChain({ videoId: 'abc123', artworkUrl: album });
    expect(chain[0]).toBe(album);
    expect(chain[1]).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
    expect(chain).toHaveLength(5);
  });

  it('skips a signed artworkUrl and falls back to videoId chain', () => {
    const signed =
      'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=-oaymw&rs=AMzJL3kabc';
    const chain = artworkChain({ videoId: 'abc123', artworkUrl: signed });
    expect(chain).toEqual([
      'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
      'https://i.ytimg.com/vi/abc123/default.jpg',
      'https://i.ytimg.com/vi/abc123/0.jpg',
    ]);
  });

  it('returns just the album URL when stable but no videoId provided', () => {
    const album = 'https://lh3.googleusercontent.com/abc=w512-h512';
    expect(artworkChain({ artworkUrl: album })).toEqual([album]);
  });
});
