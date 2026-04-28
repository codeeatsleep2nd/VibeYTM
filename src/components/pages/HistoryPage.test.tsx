import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { TrackInfo } from '../../lib/types';

// Issue #93 — HistoryPage now fetches from YTM's `FEmusic_history`
// via `browseApi.getHistory`. These tests pin the four states the
// page renders: loading skeletons, error message, empty state, and
// populated list. Mocks the IPC + the SongRow row component so the
// tests stay component-scoped.

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

const { HistoryPage } = await import('./HistoryPage');

const track = (id: string, title: string): TrackInfo => ({
  videoId: id,
  title,
  artist: 'Artist',
  album: 'Album',
  durationSecs: 180,
});

beforeEach(() => {
  getHistoryMock.mockReset();
  rememberMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HistoryPage — YTM-backed history (issue #93)', () => {
  it('renders skeleton rows while the IPC is in flight', () => {
    // Promise that never resolves so we observe the loading state.
    getHistoryMock.mockReturnValue(new Promise(() => {}));
    render(<HistoryPage />);
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0);
  });

  it('renders the populated list when getHistory resolves with tracks', async () => {
    getHistoryMock.mockResolvedValue([
      track('a', 'Track A'),
      track('b', 'Track B'),
    ]);
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByText('Track A')).toBeInTheDocument();
    });
    expect(screen.getByText('Track B')).toBeInTheDocument();
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
