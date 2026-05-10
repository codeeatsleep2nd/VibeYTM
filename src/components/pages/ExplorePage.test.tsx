import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Shelf, SearchResults, TrackInfo } from '../../lib/types';

// The /plan-design-review redesign on 2026-05-09 moved the mood pills
// from HomePage to ExplorePage. The whole interactive surface this page
// exposes (mood selection → 3-column grid of mood-filtered songs) lives
// only in ExplorePage; without these tests, a refactor could silently
// drop the SONGS_FILTER, the "All" toggle, or the cross-remount
// persistence and the regression wouldn't surface until a human notices.

const getExploreMock = vi.fn();
const searchMock = vi.fn();

vi.mock('../../lib/ipc', () => ({
  browseApi: {
    getExplore: () => getExploreMock(),
    search: (query: string, filter?: string) => searchMock(query, filter),
  },
  playFirstFromPlaylist: vi.fn(),
}));

// Force every cache read to miss so the component reaches the network mocks
// instead of seeding from a previous test's persisted payload (jsdom shares
// localStorage across tests in this file).
vi.mock('../../lib/persistentCache', () => ({
  readCache: vi.fn().mockReturnValue(null),
  writeCache: vi.fn(),
  clearCache: vi.fn(),
}));

// Login-changed handler isn't exercised in these tests but the hook still
// needs to be a no-op so import doesn't reach into Tauri.
vi.mock('../../hooks/useTauriEvent', () => ({
  useTauriEvent: () => undefined,
}));

const stubShelves: Shelf[] = [
  {
    title: 'Trending',
    items: { kind: 'Songs', data: [] },
  },
];

const stubTrack: TrackInfo = {
  videoId: 'abc123',
  title: 'Energize Anthem',
  artist: 'Test Artist',
  artistId: undefined,
  album: 'Test Album',
  albumId: undefined,
  artworkUrl: undefined,
  durationSecs: 180,
};

const moodResults: SearchResults = {
  songs: [stubTrack],
  albums: [],
  artists: [],
  playlists: [],
};

// Import after mocks so the module captures the mocked dependencies.
const { ExplorePage, resetExplorePageModuleCache } = await import(
  './ExplorePage'
);

describe('ExplorePage — mood-pill flow (issue from /plan-design-review 2026-05-09)', () => {
  beforeEach(() => {
    getExploreMock.mockReset();
    searchMock.mockReset();
    getExploreMock.mockResolvedValue(stubShelves);
    searchMock.mockResolvedValue(moodResults);
    // Wipe module-level state between tests so the previous test's last-
    // selected mood doesn't leak into the next one's initial render.
    resetExplorePageModuleCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clicking a mood pill triggers browseApi.search with the SONGS_FILTER', async () => {
    await act(async () => {
      render(<ExplorePage />);
    });

    // Wait for the initial getExplore() to settle so we're past the first-
    // load spinner before clicking a pill.
    await waitFor(() => expect(getExploreMock).toHaveBeenCalled());

    const energizeBtn = screen.getByRole('button', { name: 'Energize' });
    await act(async () => {
      fireEvent.click(energizeBtn);
    });

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledWith(
        'Energize',
        // SONGS_FILTER constant — locks the YTM filter param so a
        // refactor doesn't silently broaden the mood query into mixed
        // results.
        'EgWKAQIIAWoSEA4QCRAKEAUQBBADEBUQEBAR',
      );
    });

    // The mood result row should render with the fetched track title.
    await waitFor(() => {
      expect(screen.getByText('Energize Anthem')).toBeDefined();
    });
  });

  it('clicking "All" returns to the curated shelves view (no mood-songs grid)', async () => {
    await act(async () => {
      render(<ExplorePage />);
    });
    await waitFor(() => expect(getExploreMock).toHaveBeenCalled());

    // Pick a mood first to land in the mood-songs branch.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Relax' }));
    });
    await waitFor(() => expect(searchMock).toHaveBeenCalled());

    // Now back to "All" — the mood-songs grid should disappear.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All' }));
    });

    await waitFor(() => {
      expect(screen.queryByText('Relax Songs')).toBeNull();
    });
    // The curated shelf header should now be on screen.
    expect(screen.getByText('Trending')).toBeDefined();
  });

  it('mood selection survives unmount/remount via the module-level cache', async () => {
    const { unmount } = render(<ExplorePage />);
    await waitFor(() => expect(getExploreMock).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Workout' }));
    });
    await waitFor(() => expect(searchMock).toHaveBeenCalledWith('Workout', expect.any(String)));

    unmount();

    // Remount: the new instance should land on Workout (cached at module
    // level), not snap back to "All".
    await act(async () => {
      render(<ExplorePage />);
    });

    // Workout pill should render with the active styling. We assert via
    // text + the fact that the previously-cached mood-songs render
    // immediately (no second search call).
    expect(screen.getByText('Workout Songs')).toBeDefined();
    // Cache hit: search shouldn't fire again on the cached mood.
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the empty fallback when a mood returns zero songs', async () => {
    searchMock.mockResolvedValueOnce({
      songs: [],
      albums: [],
      artists: [],
      playlists: [],
    });

    await act(async () => {
      render(<ExplorePage />);
    });
    await waitFor(() => expect(getExploreMock).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sleep' }));
    });

    await waitFor(() => {
      expect(screen.getByText(/No songs found for "Sleep"/)).toBeDefined();
    });
  });
});
