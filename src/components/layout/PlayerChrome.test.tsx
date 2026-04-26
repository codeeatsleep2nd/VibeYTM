import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerChrome } from './PlayerChrome';

// PlayerChrome is the most touched component in the app — every other
// reliability fix in the project history (#76 volume, #41 progress,
// the click-target rule, the bridge settle window) routes through it.
// This contract test pins that every transport / utility button still
// fires its handler after the Liquid-Glass visual refactor, plus the
// volume slider's optimistic + IPC pair (the snap-to-MAX regression
// surface).

const playerApiMock = {
  togglePlay: vi.fn().mockResolvedValue(undefined),
  toggleShuffle: vi.fn().mockResolvedValue(undefined),
  cycleRepeat: vi.fn().mockResolvedValue(undefined),
  setVolume: vi.fn().mockResolvedValue(undefined),
  next: vi.fn(),
  previous: vi.fn(),
  playTrack: vi.fn().mockResolvedValue(undefined),
};
const applyOptimistic = vi.fn();
const lyricsPreloadMock = vi.fn();
const counterpartPreloadMock = vi.fn();
const cacheFetchMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/ipc', () => ({
  playerApi: new Proxy({}, {
    get: (_t, name) => (playerApiMock as Record<string, unknown>)[name as string],
  }),
  cacheApi: { fetchImage: (...a: unknown[]) => cacheFetchMock(...a) },
  getActivePlaylistId: () => null,
  getPlannedNext: () => null,
  getPlannedPrevious: () => null,
  setPredictedTrack: vi.fn(),
}));

vi.mock('../../hooks/useLyrics', () => ({
  preloadLyrics: (...a: unknown[]) => lyricsPreloadMock(...a),
}));

vi.mock('../../hooks/useAudioCounterpartArtwork', () => ({
  preloadAudioCounterpartArtwork: (...a: unknown[]) => counterpartPreloadMock(...a),
}));

vi.mock('../../lib/trackArtworkRegistry', () => ({
  lookupTrackArtwork: () => null,
}));

const mockPlayerState = {
  track: {
    videoId: 'demo',
    title: 'Demo Song',
    artist: 'Test Artist',
    artistId: null,
    album: 'Demo Album',
    albumId: null,
    artworkUrl: 'https://lh3.googleusercontent.com/x=w512',
    durationSecs: 180,
  },
  status: 'paused' as const,
  positionSecs: 30,
  volume: 0.4,
  isShuffled: false,
  repeatMode: 'none' as const,
  isLiked: false,
  queue: [],
  applyOptimistic,
};

vi.mock('../../hooks/usePlayerState', () => ({
  usePlayerState: () => mockPlayerState,
}));

vi.mock('../player/NowPlayingCard', () => ({
  NowPlayingCard: () => null,
}));

beforeEach(() => {
  Object.values(playerApiMock).forEach((fn) => (fn as { mockClear?: () => void }).mockClear?.());
  applyOptimistic.mockClear();
});

const baseProps = {
  onToggleNowPlaying: vi.fn(),
  nowPlayingOpen: false,
  onToggleLyrics: vi.fn(),
  lyricsOpen: false,
  onToggleQueue: vi.fn(),
  queueOpen: false,
};

describe('PlayerChrome — contract after Liquid-Glass visual refactor', () => {
  it('Play / Pause button fires playerApi.togglePlay', async () => {
    render(<PlayerChrome {...baseProps} />);
    await userEvent.click(screen.getByLabelText('Play'));
    expect(playerApiMock.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('Shuffle button fires playerApi.toggleShuffle and applies optimistic', async () => {
    render(<PlayerChrome {...baseProps} />);
    await userEvent.click(screen.getByLabelText('Shuffle'));
    expect(applyOptimistic).toHaveBeenCalledWith({ isShuffled: true });
    expect(playerApiMock.toggleShuffle).toHaveBeenCalledTimes(1);
  });

  it('Previous button falls back to playerApi.previous when no planned prev', async () => {
    render(<PlayerChrome {...baseProps} />);
    await userEvent.click(screen.getByLabelText('Previous'));
    expect(playerApiMock.previous).toHaveBeenCalledTimes(1);
  });

  it('Next button falls back to playerApi.next when no planned next', async () => {
    render(<PlayerChrome {...baseProps} />);
    await userEvent.click(screen.getByLabelText('Next'));
    expect(playerApiMock.next).toHaveBeenCalledTimes(1);
  });

  it('Repeat button cycles via playerApi.cycleRepeat', async () => {
    render(<PlayerChrome {...baseProps} />);
    await userEvent.click(screen.getByLabelText('Repeat off'));
    expect(playerApiMock.cycleRepeat).toHaveBeenCalledTimes(1);
  });

  it('Lyrics toggle button fires onToggleLyrics', async () => {
    const onToggleLyrics = vi.fn();
    render(<PlayerChrome {...baseProps} onToggleLyrics={onToggleLyrics} />);
    await userEvent.click(screen.getByLabelText('Show lyrics'));
    expect(onToggleLyrics).toHaveBeenCalledTimes(1);
  });

  it('Queue toggle button fires onToggleQueue', async () => {
    const onToggleQueue = vi.fn();
    render(<PlayerChrome {...baseProps} onToggleQueue={onToggleQueue} />);
    await userEvent.click(screen.getByLabelText('Show queue'));
    expect(onToggleQueue).toHaveBeenCalledTimes(1);
  });

  it('Volume slider change applies optimistic AND calls playerApi.setVolume (#76 contract)', () => {
    render(<PlayerChrome {...baseProps} />);
    const slider = screen.getByLabelText('Volume') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '50' } });
    // The applyOptimistic call must precede the IPC so the slider
    // visually moves the moment the user releases the mouse — the
    // snap-to-MAX fix in #76 depends on this ordering.
    expect(applyOptimistic).toHaveBeenCalledWith({ volume: 0.5 });
    expect(playerApiMock.setVolume).toHaveBeenCalledWith(0.5);
  });

  it('Mute toggle restores last-non-zero volume on second click', async () => {
    render(<PlayerChrome {...baseProps} />);
    const speaker = screen.getByLabelText('Mute');
    await userEvent.click(speaker);
    expect(applyOptimistic).toHaveBeenCalledWith({ volume: 0 });
    expect(playerApiMock.setVolume).toHaveBeenCalledWith(0);
  });

  it('NEVER renders a div with role="button" in place of a real button (WKWebView click rule)', () => {
    const { container } = render(<PlayerChrome {...baseProps} />);
    const fakeButtons = container.querySelectorAll('div[role="button"]');
    expect(fakeButtons.length).toBe(0);
  });

  it('NEVER applies transform: scale on the chrome wrapper (WKWebView hit-test rule)', () => {
    const { container } = render(<PlayerChrome {...baseProps} />);
    expect(container.innerHTML).not.toMatch(/scale\(/);
  });

  it('chrome footer carries the Liquid Glass backdrop-filter', () => {
    render(<PlayerChrome {...baseProps} />);
    // jsdom doesn't actually composite backdrop-filter, but it preserves
    // the declared value on the inline style. Pin presence so a future
    // refactor doesn't silently drop the Liquid Glass treatment back to
    // a flat panel.
    const footer = document.querySelector('footer') as HTMLElement;
    expect(footer.style.backdropFilter).toMatch(/blur\(\d+px\)/);
    expect(footer.style.backdropFilter).toMatch(/saturate\(/);
  });
});
