import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NowPlaying } from './index';

// Issue #71 gap 2: NowPlaying derives `splitMode = showLyrics || queueOpen`
// and uses it to drive the cover-column's `justify-content` so the cover
// shifts left whenever EITHER drawer (lyrics OR queue) is open. There was
// no test pinning that the queue-open branch alone triggers split layout.
// The original issue text talked about `paddingRight` flipping, but after
// the LyricsOverlay refactor the live-load-bearing style is
// `justify-content` — the test pins the actual current contract.

vi.mock('../../../hooks/usePlayerState', () => ({
  usePlayerState: () => ({
    track: {
      videoId: 'demo',
      title: 'Demo',
      artist: 'Test Artist',
      artistId: null,
      album: '',
      albumId: null,
      artworkUrl: '',
      durationSecs: 180,
    },
    activePlaylistId: null,
  }),
}));

vi.mock('../../../hooks/useAudioCounterpartArtwork', () => ({
  useAudioCounterpartArtwork: () => null,
  preloadAudioCounterpartArtwork: vi.fn(),
}));

vi.mock('../../../hooks/useCoverColors', () => ({
  useCoverColors: () => ({
    primary: 'oklch(50% 0.05 270)',
    secondary: 'oklch(20% 0.02 270)',
    text: 'oklch(95% 0 0)',
  }),
}));

vi.mock('../../../lib/trackArtworkRegistry', () => ({
  lookupTrackArtwork: () => null,
}));

vi.mock('../../../lib/showCoverRegistry', () => ({
  lookupShowCover: () => null,
}));

vi.mock('../../CachedImage', () => ({
  CachedImage: () => null,
}));

vi.mock('./CoverBackdrop', () => ({
  CoverBackdrop: () => null,
}));

function getCoverColumn(container: HTMLElement): HTMLElement {
  // The cover column is the only child wrapped inside the SafeOverlay
  // root that owns the splitMode-driven justify-content. SafeOverlay
  // renders its tag directly with role + aria-label so we anchor on
  // that and grab its first child.
  const overlay = container.querySelector('[aria-label="Now playing"]');
  expect(overlay).not.toBeNull();
  const inner = overlay!.firstElementChild as HTMLElement | null;
  expect(inner).not.toBeNull();
  return inner!;
}

describe('NowPlaying — splitMode shifts the cover when either drawer is open (issue #71)', () => {
  it('queueOpen=true alone triggers splitMode (justify-content: flex-start)', () => {
    const { container } = render(
      <NowPlaying isOpen onClose={() => {}} queueOpen showLyrics={false} />,
    );
    const inner = getCoverColumn(container);
    expect(inner.style.justifyContent).toBe('flex-start');
  });

  it('showLyrics=true alone triggers splitMode (justify-content: flex-start)', () => {
    const { container } = render(
      <NowPlaying isOpen onClose={() => {}} queueOpen={false} showLyrics />,
    );
    const inner = getCoverColumn(container);
    expect(inner.style.justifyContent).toBe('flex-start');
  });

  it('both flags false → cover centered (justify-content: center)', () => {
    const { container } = render(
      <NowPlaying
        isOpen
        onClose={() => {}}
        queueOpen={false}
        showLyrics={false}
      />,
    );
    const inner = getCoverColumn(container);
    expect(inner.style.justifyContent).toBe('center');
  });
});
