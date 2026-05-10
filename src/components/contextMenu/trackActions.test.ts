import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock IPC + appNav so the action-builder doesn't pull live tauri imports.
vi.mock('../../lib/ipc', () => ({
  playerApi: {
    playTrack: vi.fn(),
    addToQueue: vi.fn(),
  },
}));

vi.mock('../../lib/appNav', () => ({
  hasOpenArtistHandler: () => true,
  openArtist: vi.fn(),
}));

const openAddToPlaylistPicker = vi.fn();
vi.mock('../../lib/addToPlaylistRegistry', () => ({
  openAddToPlaylistPicker: (req: unknown) => openAddToPlaylistPicker(req),
}));

const { buildTrackContextMenu } = await import('./trackActions');

const trackWithVideo = {
  videoId: 'abc123',
  title: 'Test Track',
  artist: 'Test Artist',
  artistId: undefined,
  album: 'Test Album',
  albumId: undefined,
  artworkUrl: undefined,
  durationSecs: 180,
};

const trackWithoutVideo = { ...trackWithVideo, videoId: '' };

describe('trackActions: Add to Playlist menu item', () => {
  afterEach(() => {
    openAddToPlaylistPicker.mockClear();
  });

  it('appears in the play section', () => {
    const sections = buildTrackContextMenu({ track: trackWithVideo });
    const playSection = sections.find((s) => s.id === 'play');
    expect(playSection).toBeDefined();
    const item = playSection?.items.find((i) => i.id === 'add-to-playlist');
    expect(item).toBeDefined();
    expect(item?.label).toBe('Add to Playlist…');
  });

  it('is disabled when track.videoId is empty', () => {
    const sections = buildTrackContextMenu({ track: trackWithoutVideo });
    const item = sections
      .flatMap((s) => s.items)
      .find((i) => i.id === 'add-to-playlist');
    expect(item?.disabled).toBe(true);
  });

  it('onActivate calls openAddToPlaylistPicker with videoId, title, and the activation position', () => {
    const sections = buildTrackContextMenu({ track: trackWithVideo });
    const item = sections
      .flatMap((s) => s.items)
      .find((i) => i.id === 'add-to-playlist');
    item?.onActivate({ x: 250, y: 400 });
    expect(openAddToPlaylistPicker).toHaveBeenCalledTimes(1);
    expect(openAddToPlaylistPicker).toHaveBeenCalledWith({
      videoId: 'abc123',
      trackTitle: 'Test Track',
      position: { x: 250, y: 400 },
    });
  });

  it('onActivate falls back to (0,0) when no position is supplied', () => {
    const sections = buildTrackContextMenu({ track: trackWithVideo });
    const item = sections
      .flatMap((s) => s.items)
      .find((i) => i.id === 'add-to-playlist');
    item?.onActivate();
    expect(openAddToPlaylistPicker).toHaveBeenCalledWith({
      videoId: 'abc123',
      trackTitle: 'Test Track',
      position: { x: 0, y: 0 },
    });
  });
});
