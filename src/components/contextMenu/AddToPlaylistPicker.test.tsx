import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PlaylistSummary } from '../../lib/types';

const getLibraryPlaylistsMock = vi.fn();
const addTrackToPlaylistMock = vi.fn();
const createPlaylistMock = vi.fn();
const toastShowMock = vi.fn();

vi.mock('../../lib/ipc', () => ({
  browseApi: {
    getLibraryPlaylists: () => getLibraryPlaylistsMock(),
    addTrackToPlaylist: (playlistId: string, videoId: string) =>
      addTrackToPlaylistMock(playlistId, videoId),
    createPlaylist: (
      title: string,
      description: string,
      privacy: string,
      seedVideoId: string | null,
    ) => createPlaylistMock(title, description, privacy, seedVideoId),
  },
}));

vi.mock('../../lib/toast', () => ({
  toast: { show: (s: unknown) => toastShowMock(s) },
}));

let loginState: boolean | null = true;
vi.mock('../../hooks/useLoginState', () => ({
  useLoginState: () => loginState,
}));

vi.mock('../CachedImage', () => ({
  CachedImage: () => null,
}));

const {
  openAddToPlaylistPicker,
  closeAddToPlaylistPicker,
  __resetAddToPlaylistRegistryForTests,
} = await import('../../lib/addToPlaylistRegistry');
const { __resetAddToPlaylistPickerForTests, AddToPlaylistPicker } = await import(
  './AddToPlaylistPicker'
);

const mkPlaylist = (
  id: string,
  title: string,
  trackCount: number | undefined = 5,
): PlaylistSummary => ({
  playlistId: id,
  title,
  artworkUrl: '',
  trackCount,
});

const flushTimers = async () => {
  // Allow scheduled close-handler attach (setTimeout 0) + microtasks to run.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

describe('AddToPlaylistPicker', () => {
  beforeEach(() => {
    __resetAddToPlaylistRegistryForTests();
    __resetAddToPlaylistPickerForTests();
    getLibraryPlaylistsMock.mockReset();
    addTrackToPlaylistMock.mockReset();
    createPlaylistMock.mockReset();
    toastShowMock.mockReset();
    loginState = true;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when registry has no state', () => {
    render(<AddToPlaylistPicker />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when registry has state', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([
      mkPlaylist('PL_1', 'Workout', 23),
    ]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'vid1',
        trackTitle: 'Hello',
        position: { x: 100, y: 200 },
      });
    });
    expect(
      await screen.findByRole('dialog', { name: 'Add to playlist' }),
    ).toBeDefined();
  });

  it('clicking a playlist row triggers addTrackToPlaylist + toast + close', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([
      mkPlaylist('PL_workout', 'Workout', 23),
    ]);
    // `true` = YTM actually added the track (not a dedupe-skip).
    addTrackToPlaylistMock.mockResolvedValue(true);

    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'vid1',
        trackTitle: 'Hello',
        position: { x: 0, y: 0 },
      });
    });
    const row = await screen.findByRole('option', { name: /Workout/ });
    await act(async () => {
      fireEvent.click(row);
    });

    await waitFor(() => {
      expect(addTrackToPlaylistMock).toHaveBeenCalledWith('PL_workout', 'vid1');
    });
    expect(toastShowMock).toHaveBeenCalledWith({ message: 'Added to Workout' });
  });

  it('clicking a playlist that already has the track shows "Already in" toast', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([
      mkPlaylist('PL_workout', 'Workout', 23),
    ]);
    // `false` = YTM deduped — the track was already in the playlist.
    addTrackToPlaylistMock.mockResolvedValue(false);

    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'vid1',
        trackTitle: 'Hello',
        position: { x: 0, y: 0 },
      });
    });
    const row = await screen.findByRole('option', { name: /Workout/ });
    await act(async () => {
      fireEvent.click(row);
    });

    await waitFor(() => {
      expect(toastShowMock).toHaveBeenCalledWith({
        message: 'Already in Workout',
      });
    });
  });

  it('search filters the list live', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([
      mkPlaylist('PL_1', 'Workout'),
      mkPlaylist('PL_2', 'Chill'),
      mkPlaylist('PL_3', 'Wedding'),
    ]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v',
        trackTitle: 'T',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByRole('option', { name: /Workout/ });
    fireEvent.change(screen.getByPlaceholderText(/Search your playlists/), {
      target: { value: 'wo' },
    });
    expect(screen.queryByRole('option', { name: /Chill/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Wedding/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Workout/ })).toBeDefined();
  });

  it('switches to create view when "+ New playlist" is clicked', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([mkPlaylist('PL_1', 'Workout')]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v',
        trackTitle: 'T',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByRole('option', { name: /Workout/ });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create new playlist' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'New playlist' }),
    ).toBeDefined();
  });

  it('Create button is disabled until name has non-whitespace content', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v',
        trackTitle: 'T',
        position: { x: 0, y: 0 },
      });
    });
    // Land in the create view (zero playlists → "+ New playlist" prominent).
    await screen.findByRole('button', { name: 'Create new playlist' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create new playlist' }),
    );
    const input = await screen.findByLabelText(/Name/);
    fireEvent.change(input, { target: { value: '   ' } });
    const createBtn = screen.getByRole('button', { name: 'Create' });
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'My Playlist' } });
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('submitting create view calls createPlaylist with privacy + seed videoId', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([]);
    createPlaylistMock.mockResolvedValue('PL_NEW_123');

    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'vid1',
        trackTitle: 'Hello',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByRole('button', { name: 'Create new playlist' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create new playlist' }),
    );
    const input = await screen.findByLabelText(/Name/);
    fireEvent.change(input, { target: { value: 'My Mix' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    });

    await waitFor(() => {
      expect(createPlaylistMock).toHaveBeenCalledWith(
        'My Mix',
        '',
        'PRIVATE',
        'vid1',
      );
    });
    expect(toastShowMock).toHaveBeenCalledWith({ message: 'Added to My Mix' });
  });

  it('shows the "no playlists yet" zero state when library is empty', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v',
        trackTitle: 'T',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByText(/No playlists yet/);
    expect(
      screen.getByRole('button', { name: 'Create new playlist' }),
    ).toBeDefined();
  });

  it('shows sign-in CTA when user is signed out', async () => {
    loginState = false;
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v',
        trackTitle: 'T',
        position: { x: 0, y: 0 },
      });
    });
    expect(await screen.findByText(/Sign in to save tracks/)).toBeDefined();
    // The IPC must NOT have fired in the signed-out branch.
    expect(getLibraryPlaylistsMock).not.toHaveBeenCalled();
  });

  it('IPC error surfaces an inline retry banner instead of a toast', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([
      mkPlaylist('PL_1', 'Workout'),
    ]);
    addTrackToPlaylistMock.mockRejectedValue(new Error('Network down'));

    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'vid1',
        trackTitle: 'Hello',
        position: { x: 0, y: 0 },
      });
    });
    const row = await screen.findByRole('option', { name: /Workout/ });
    await act(async () => {
      fireEvent.click(row);
    });

    expect(await screen.findByText(/Network down/)).toBeDefined();
    expect(toastShowMock).not.toHaveBeenCalled();
  });

  it('opening the registry for a different track replaces the picker (re-anchor)', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([
      mkPlaylist('PL_1', 'Workout'),
    ]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'first',
        trackTitle: 'First',
        position: { x: 100, y: 100 },
      });
    });
    await screen.findByRole('option', { name: /Workout/ });

    act(() => {
      openAddToPlaylistPicker({
        videoId: 'second',
        trackTitle: 'Second',
        position: { x: 250, y: 250 },
      });
    });
    await flushTimers();
    // Dialog still rendered; videoId on the next pick reflects the
    // new track.
    const row = screen.getByRole('option', { name: /Workout/ });
    addTrackToPlaylistMock.mockResolvedValue(undefined);
    await act(async () => {
      fireEvent.click(row);
    });
    await waitFor(() => {
      expect(addTrackToPlaylistMock).toHaveBeenCalledWith('PL_1', 'second');
    });
  });

  it('Escape key closes the picker', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v',
        trackTitle: 'T',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByRole('dialog');
    await flushTimers(); // close-handlers are attached on next tick

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('closeAddToPlaylistPicker() unmounts the picker', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v',
        trackTitle: 'T',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByRole('dialog');
    act(() => {
      closeAddToPlaylistPicker();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cache hit on second open within 60s does not refetch', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([
      mkPlaylist('PL_1', 'Workout'),
    ]);
    render(<AddToPlaylistPicker />);

    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v1',
        trackTitle: 'A',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByRole('option', { name: /Workout/ });
    expect(getLibraryPlaylistsMock).toHaveBeenCalledTimes(1);

    act(() => {
      closeAddToPlaylistPicker();
    });
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v2',
        trackTitle: 'B',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByRole('option', { name: /Workout/ });
    // Still 1 — the second open hit the cache.
    expect(getLibraryPlaylistsMock).toHaveBeenCalledTimes(1);
  });

  it('filters out auto-generated mix playlists (RD prefix)', async () => {
    getLibraryPlaylistsMock.mockResolvedValue([
      mkPlaylist('PL_1', 'Workout'),
      mkPlaylist('RDMIX_AUTO', 'My Mix Auto'),
      mkPlaylist('PL_2', 'Chill'),
    ]);
    render(<AddToPlaylistPicker />);
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'v',
        trackTitle: 'T',
        position: { x: 0, y: 0 },
      });
    });
    await screen.findByRole('option', { name: /Workout/ });
    expect(screen.queryByRole('option', { name: /My Mix Auto/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Chill/ })).toBeDefined();
  });
});
