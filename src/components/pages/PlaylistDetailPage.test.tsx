import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { PlaylistDetail, TrackInfo } from '../../lib/types';

// Pin the isShow ? EpisodeRow : SongRow branch (PR #97 review H3).
// A regression flipping the condition or breaking the MPSPP prefix
// check would silently render music rows for podcast episodes, losing
// the per-episode publish date + description layout. Keeps the
// branching contract testable without booting the full hero.

const getPlaylistMock = vi.fn();

vi.mock('../../lib/ipc', () => ({
  browseApi: {
    getPlaylist: (id: string) => getPlaylistMock(id),
    savePlaylistToLibrary: vi.fn(),
    removePlaylistFromLibrary: vi.fn(),
  },
  playerApi: {
    getState: vi.fn().mockResolvedValue(null),
    playFirstFromPlaylist: vi.fn(),
    setPlaylist: vi.fn(),
    next: vi.fn(),
  },
  playFirstFromPlaylist: vi.fn(),
}));

vi.mock('../../lib/trackArtworkRegistry', () => ({
  rememberTrackArtworks: vi.fn(),
}));
vi.mock('../../lib/showCoverRegistry', () => ({
  rememberShowCover: vi.fn(),
}));
vi.mock('../../lib/trackMetaRegistry', () => ({
  rememberTrackMetas: vi.fn(),
}));
vi.mock('../../hooks/useCoverColors', () => ({
  useCoverColors: () => ({ primary: '#000', secondary: '#000' }),
}));

vi.mock('../browse/SongRow', () => ({
  SongRow: ({ track }: { track: TrackInfo }) => (
    <div data-testid="song-row">{track.title}</div>
  ),
}));
vi.mock('../browse/EpisodeRow', () => ({
  EpisodeRow: ({ track }: { track: TrackInfo }) => (
    <div data-testid="episode-row">{track.title}</div>
  ),
}));

vi.mock('../DetailPageHero', () => ({
  DetailPageHero: ({ title, kind }: { title: string; kind: string }) => (
    <div data-testid="hero">{`${kind}:${title}`}</div>
  ),
}));

vi.mock('../LoadingOverlay', () => ({
  LoadingSpinner: () => <div data-testid="spinner" />,
}));

vi.mock('../Skeleton', () => ({
  SkeletonDetailHero: () => null,
  SkeletonRow: () => <div data-testid="skeleton-row" />,
}));

const { PlaylistDetailPage } = await import('./PlaylistDetailPage');

const track = (id: string, title: string): TrackInfo => ({
  videoId: id,
  title,
  artist: 'Artist',
  album: 'Album',
  durationSecs: 180,
});

const detail = (
  id: string,
  tracks: TrackInfo[],
  overrides: Partial<PlaylistDetail> = {},
): PlaylistDetail => ({
  playlistId: id,
  title: 'Title',
  artworkUrl: '',
  tracks,
  isInLibrary: false,
  isAlbum: false,
  ...overrides,
});

beforeEach(() => {
  getPlaylistMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PlaylistDetailPage — track row branching', () => {
  it('renders EpisodeRow for podcast/show playlists (MPSPP prefix)', async () => {
    getPlaylistMock.mockResolvedValue(
      detail('MPSPPshow123', [track('e1', 'Episode One')]),
    );
    render(
      <PlaylistDetailPage playlistId="MPSPPshow123" onBack={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Episode One')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('episode-row')).not.toBeNull();
    expect(screen.queryByTestId('song-row')).toBeNull();
  });

  it('renders SongRow for music playlists (non-MPSPP)', async () => {
    getPlaylistMock.mockResolvedValue(
      detail('PLmusic456', [track('s1', 'Song One')]),
    );
    render(<PlaylistDetailPage playlistId="PLmusic456" onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('Song One')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('song-row')).not.toBeNull();
    expect(screen.queryByTestId('episode-row')).toBeNull();
  });

  it('renders SongRow for album playlists (MPRE prefix, not MPSPP)', async () => {
    // The isShow gate is strict on MPSPP — albums (MPRE*) must NOT
    // accidentally fall into the episode branch.
    getPlaylistMock.mockResolvedValue(
      detail('MPREalbum789', [track('a1', 'Album Track')], { isAlbum: true }),
    );
    render(
      <PlaylistDetailPage playlistId="MPREalbum789" onBack={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Album Track')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('song-row')).not.toBeNull();
    expect(screen.queryByTestId('episode-row')).toBeNull();
  });
});
