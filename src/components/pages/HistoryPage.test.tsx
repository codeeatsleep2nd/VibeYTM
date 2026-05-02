import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { HistorySection, TrackInfo } from '../../lib/types';

// HistoryPage now fetches date-grouped sections from
// `browseApi.getHistory` and buckets them on the FE into Today /
// Yesterday / This week / Earlier. These tests pin the four states
// the page renders (loading, populated grouped, empty, error) plus
// the bucketing helper itself.

const getHistoryMock = vi.fn();
const rememberMock = vi.fn();

vi.mock('../../lib/ipc', () => ({
  browseApi: {
    getHistory: () => getHistoryMock(),
  },
}));

vi.mock('../../lib/trackArtworkRegistry', () => ({
  rememberTrackArtworks: (...a: unknown[]) => rememberMock(...a),
}));

vi.mock('../browse/SongRow', () => ({
  SongRow: ({ track }: { track: TrackInfo }) => (
    <div data-testid="song-row">{track.title}</div>
  ),
}));

vi.mock('../Skeleton', () => ({
  SkeletonRow: () => <div data-testid="skeleton-row" />,
  SkeletonCard: () => null,
}));

// LiquidGlass is heavy + DOM-effect-driven; stub to a passthrough.
vi.mock('@liquidglass/react', () => ({
  LiquidGlass: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { HistoryPage, bucketHistorySections } = await import('./HistoryPage');

const track = (id: string, title: string): TrackInfo => ({
  videoId: id,
  title,
  artist: 'Artist',
  album: 'Album',
  durationSecs: 180,
});

const section = (label: string, tracks: TrackInfo[]): HistorySection => ({
  label,
  tracks,
});

beforeEach(() => {
  getHistoryMock.mockReset();
  rememberMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HistoryPage — grouped history', () => {
  it('renders skeleton rows while the IPC is in flight', () => {
    getHistoryMock.mockReturnValue(new Promise(() => {}));
    render(<HistoryPage />);
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0);
  });

  it('renders bucket headings and tracks under each', async () => {
    getHistoryMock.mockResolvedValue([
      section('Today', [track('t1', 'Today Song')]),
      section('Yesterday', [track('y1', 'Yesterday Song')]),
      section('Last week', [track('lw1', 'Older Song')]),
    ]);
    render(<HistoryPage />);
    await waitFor(() =>
      expect(screen.getByText('Today Song')).toBeInTheDocument(),
    );
    expect(screen.getByText('Yesterday Song')).toBeInTheDocument();
    expect(screen.getByText('Older Song')).toBeInTheDocument();
    // Group headings rendered for non-empty buckets only — "Today",
    // "Yesterday", and "Earlier" (Last week is bucketed there because
    // its date can't be parsed).
    expect(
      screen.getByRole('heading', { level: 2, name: 'Today' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Yesterday' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Earlier' }),
    ).toBeInTheDocument();
    expect(rememberMock).toHaveBeenCalled();
    expect(screen.queryByTestId('skeleton-row')).toBeNull();
  });

  it('renders the empty state when getHistory resolves with []', async () => {
    getHistoryMock.mockResolvedValue([]);
    render(<HistoryPage />);
    await waitFor(() =>
      expect(
        screen.getByText(/No recently played tracks yet/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('song-row')).toBeNull();
  });

  it('renders an error message when getHistory rejects', async () => {
    getHistoryMock.mockRejectedValue(new Error('network'));
    render(<HistoryPage />);
    await waitFor(() =>
      expect(screen.getByText(/Could not load history/i)).toBeInTheDocument(),
    );
  });
});

describe('bucketHistorySections', () => {
  // Pin a fixed "now" so the date math is deterministic.
  const now = new Date('2026-05-02T10:00:00Z');

  it('routes "Today" and "Yesterday" labels into their named buckets', () => {
    const out = bucketHistorySections(
      [
        section('Today', [track('a', 'A')]),
        section('Yesterday', [track('b', 'B')]),
      ],
      now,
    );
    expect(out.Today.map((t) => t.title)).toEqual(['A']);
    expect(out.Yesterday.map((t) => t.title)).toEqual(['B']);
    expect(out['This week']).toEqual([]);
    expect(out.Earlier).toEqual([]);
  });

  it('case-insensitive on the day labels', () => {
    const out = bucketHistorySections(
      [
        section('TODAY', [track('a', 'A')]),
        section('  yesterday  ', [track('b', 'B')]),
      ],
      now,
    );
    expect(out.Today.map((t) => t.title)).toEqual(['A']);
    expect(out.Yesterday.map((t) => t.title)).toEqual(['B']);
  });

  it('dates within the last 6 days (excluding today/yesterday) go to "This week"', () => {
    // 3 days before "now": 2026-04-29
    const out = bucketHistorySections(
      [section('April 29, 2026', [track('a', 'A')])],
      now,
    );
    expect(out['This week'].map((t) => t.title)).toEqual(['A']);
    expect(out.Earlier).toEqual([]);
  });

  it('older parsed dates fall to "Earlier"', () => {
    const out = bucketHistorySections(
      [section('March 1, 2026', [track('a', 'A')])],
      now,
    );
    expect(out.Earlier.map((t) => t.title)).toEqual(['A']);
    expect(out['This week']).toEqual([]);
  });

  it('unparseable labels (e.g. "Last week") fall to "Earlier"', () => {
    const out = bucketHistorySections(
      [section('Last week', [track('a', 'A')])],
      now,
    );
    expect(out.Earlier.map((t) => t.title)).toEqual(['A']);
  });

  it('multiple sections in the same bucket merge in encounter order', () => {
    const out = bucketHistorySections(
      [
        section('Today', [track('a', 'A')]),
        section('Today', [track('b', 'B')]),
      ],
      now,
    );
    expect(out.Today.map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('empty input returns empty buckets', () => {
    const out = bucketHistorySections([], now);
    expect(out.Today).toEqual([]);
    expect(out.Yesterday).toEqual([]);
    expect(out['This week']).toEqual([]);
    expect(out.Earlier).toEqual([]);
  });
});
