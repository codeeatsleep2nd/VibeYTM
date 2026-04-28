import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Pin the regression caught in code review of ba71fb0: after Clear,
// a newly-played track must still surface. The fix replaces the
// `showAll: boolean` flag with a `clearedAt: number | null` cut-off
// so entries with `playedAt > clearedAt` pass the filter.

import type { HistoryEntry } from '../../lib/playbackHistory';

const entriesRef: { current: HistoryEntry[] } = { current: [] };
const clearMock = vi.fn();

vi.mock('../../hooks/usePlaybackHistory', () => ({
  usePlaybackHistory: () => entriesRef.current,
}));

vi.mock('../../lib/playbackHistory', () => ({
  clearHistory: () => clearMock(),
}));

vi.mock('../browse/SongRow', () => ({
  SongRow: (props: { track: { videoId: string; title: string } }) => (
    <div data-testid="song-row" data-vid={props.track.videoId}>
      {props.track.title}
    </div>
  ),
}));

const { HistoryPage } = await import('./HistoryPage');

const entry = (videoId: string, title: string, playedAt: number): HistoryEntry => ({
  track: {
    videoId,
    title,
    artist: 'A',
    album: 'B',
    durationSecs: 180,
  },
  playedAt,
});

beforeEach(() => {
  entriesRef.current = [];
  clearMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HistoryPage — Clear cut-off semantics (issue #83 follow-up)', () => {
  it('renders all entries when nothing has been cleared', () => {
    entriesRef.current = [
      entry('a', 'Track A', 100),
      entry('b', 'Track B', 200),
    ];
    render(<HistoryPage />);
    expect(screen.getByText('Track A')).toBeInTheDocument();
    expect(screen.getByText('Track B')).toBeInTheDocument();
  });

  it('Clear hides existing entries AND surfaces newly-played ones afterwards', () => {
    // Stub Date.now() so the cut-off timestamp is deterministic. We use
    // `fireEvent` (synchronous) instead of `userEvent` because user-event's
    // built-in delays don't compose with `vi.useFakeTimers()`.
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);

    entriesRef.current = [
      entry('a', 'Track A', 500),
      entry('b', 'Track B', 600),
    ];
    const { rerender } = render(<HistoryPage />);
    expect(screen.getByText('Track A')).toBeInTheDocument();

    // Click Clear at wall-clock 1000.
    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));
    expect(clearMock).toHaveBeenCalledTimes(1);
    rerender(<HistoryPage />);
    // Old entries are filtered out (their playedAt <= clearedAt = 1000).
    expect(screen.queryByText('Track A')).not.toBeInTheDocument();
    expect(screen.queryByText('Track B')).not.toBeInTheDocument();
    expect(
      screen.getByText(/No recently played tracks yet/i),
    ).toBeInTheDocument();

    // Now simulate a NEW track playing at wall-clock 2000 — the recorder
    // would write it to localStorage, the hook's TRACK_CHANGED listener
    // would refresh `entries` to include it. Cut-off is still 1000, so
    // 2000 > 1000 ⇒ row must surface.
    dateNowSpy.mockReturnValue(2000);
    entriesRef.current = [entry('c', 'Track C', 2000)];
    rerender(<HistoryPage />);
    expect(screen.getByText('Track C')).toBeInTheDocument();
    // Old ones still suppressed.
    expect(screen.queryByText('Track A')).not.toBeInTheDocument();
    dateNowSpy.mockRestore();
  });

  it('shows the empty-state copy when there are no entries at all', () => {
    entriesRef.current = [];
    render(<HistoryPage />);
    expect(
      screen.getByText(/No recently played tracks yet/i),
    ).toBeInTheDocument();
    // Clear button only renders when there ARE entries — otherwise the
    // header is bare.
    expect(screen.queryByRole('button', { name: /Clear/i })).toBeNull();
  });
});
