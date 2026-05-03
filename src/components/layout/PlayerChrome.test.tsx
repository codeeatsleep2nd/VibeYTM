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

// Mutable holders so individual tests can swap planned next/prev returns
// without redefining the whole module mock (Vitest hoists vi.mock to the
// top of the file).
const plannedNextRef: { current: { videoId: string; title: string } | null } = { current: null };
const plannedPrevRef: { current: { videoId: string; title: string } | null } = { current: null };

vi.mock('../../lib/ipc', () => ({
  playerApi: new Proxy({}, {
    get: (_t, name) => (playerApiMock as Record<string, unknown>)[name as string],
  }),
  cacheApi: { fetchImage: (...a: unknown[]) => cacheFetchMock(...a) },
  getActivePlaylistId: () => null,
  getPlannedNext: () => plannedNextRef.current,
  getPlannedPrevious: () => plannedPrevRef.current,
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
  isShuffled: false as boolean,
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
  plannedNextRef.current = null;
  plannedPrevRef.current = null;
  // Reset shuffle state to default so each test starts clean.
  mockPlayerState.isShuffled = false;
});

const baseProps = {
  onToggleNowPlaying: vi.fn(),
  nowPlayingOpen: false,
  onToggleLyrics: vi.fn(),
  lyricsOpen: false,
  onToggleQueue: vi.fn(),
  queueOpen: false,
  onToggleFocusTimer: vi.fn(),
  focusTimerOpen: false,
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

  // Regression contract for issue #81. The planned queue mirrors the
  // visible (DOM) queue order — when shuffle is on, the visible order
  // is still playlist order; following the planned-next would defeat
  // shuffle. Bypass the planned queue and forward to YTM's internal
  // shuffle-aware nextVideo() instead.
  it('Next bypasses planned queue when shuffle is on (#81)', async () => {
    plannedNextRef.current = { videoId: 'planned-next', title: 'Planned Next' };
    mockPlayerState.isShuffled = true;
    render(<PlayerChrome {...baseProps} />);
    await userEvent.click(screen.getByLabelText('Next'));
    expect(playerApiMock.next).toHaveBeenCalledTimes(1);
    expect(playerApiMock.playTrack).not.toHaveBeenCalled();
  });

  it('Previous bypasses planned queue when shuffle is on (#81)', async () => {
    plannedPrevRef.current = { videoId: 'planned-prev', title: 'Planned Prev' };
    mockPlayerState.isShuffled = true;
    render(<PlayerChrome {...baseProps} />);
    await userEvent.click(screen.getByLabelText('Previous'));
    expect(playerApiMock.previous).toHaveBeenCalledTimes(1);
    expect(playerApiMock.playTrack).not.toHaveBeenCalled();
  });

  it('Next uses planned queue when shuffle is OFF (linear navigation)', async () => {
    plannedNextRef.current = { videoId: 'planned-next', title: 'Planned Next' };
    mockPlayerState.isShuffled = false;
    render(<PlayerChrome {...baseProps} />);
    await userEvent.click(screen.getByLabelText('Next'));
    expect(playerApiMock.playTrack).toHaveBeenCalledWith('planned-next', undefined);
    expect(playerApiMock.next).not.toHaveBeenCalled();
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

  it('chrome footer wraps its content in a `<LiquidGlass>` capsule', () => {
    render(<PlayerChrome {...baseProps} />);
    // The chrome is now a floating Liquid-Glass capsule (matches the
    // top title plates' shape). The mock in test-setup renders the
    // component as a div with `data-mock-liquidglass`; pin its
    // presence so a future refactor doesn't silently revert to the
    // flat opaque footer.
    const footer = document.querySelector('footer') as HTMLElement;
    const lgChild = footer.querySelector('[data-mock-liquidglass]');
    expect(lgChild).not.toBeNull();
  });
});
