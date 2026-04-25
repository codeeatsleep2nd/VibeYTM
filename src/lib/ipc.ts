import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { AccountInfo, PlayerState, TrackInfo, SearchResults, Shelf, PlaylistSummary, PlaylistDetail, AlbumSummary, ArtistSummary, Lyrics } from './types';
import type { RepeatMode } from './types';

export interface CacheStats {
  image_count: number;
  image_bytes: number;
  track_count: number;
  track_bytes: number;
  total_bytes: number;
  max_bytes: number;
}

export const cacheApi = {
  fetchImage: (url: string) => invoke<string>('cache_fetch_image', { url }),
  clear: () => invoke<number>('cache_clear'),
  stats: () => invoke<CacheStats>('cache_stats'),
  convertToAssetUrl: (path: string) => convertFileSrc(path),
};

// Last playlist/album the user explicitly started playing. YTM's `next`
// endpoint needs this to return the full album/playlist queue instead of
// the single-track auto-radio, so the Queue panel can show every song.
// Cleared whenever a track is played without a playlist context.
//
// Exposed as a tiny subscribable so React components (e.g. QueuePanel) can
// re-run effects when it changes — even when the currently-playing videoId
// stays the same (e.g. user clicks Play-All on a list whose first track is
// already playing). Without this, an effect keyed only on currentVideoId
// would never refetch with the new playlist context.
let activePlaylistId: string | null = null;
type ActivePlaylistListener = (id: string | null) => void;
const activePlaylistListeners = new Set<ActivePlaylistListener>();

export function getActivePlaylistId(): string | null {
  return activePlaylistId;
}

export function subscribeActivePlaylist(
  listener: ActivePlaylistListener,
): () => void {
  activePlaylistListeners.add(listener);
  return () => {
    activePlaylistListeners.delete(listener);
  };
}

function setActivePlaylistId(id: string | null): void {
  if (id === activePlaylistId) return;
  activePlaylistId = id;
  for (const listener of activePlaylistListeners) listener(id);
}

export const playerApi = {
  play: () => invoke('play'),
  pause: () => invoke('pause'),
  togglePlay: () => invoke('toggle_play'),
  next: () => invoke('next_track'),
  previous: () => invoke('previous_track'),
  seek: (secs: number) => invoke('seek', { secs }),
  setVolume: (level: number) => invoke('set_volume', { level }),
  getState: () => invoke<PlayerState>('get_player_state'),
  getAccountInfo: () => invoke<AccountInfo | null>('get_account_info'),
  getLoginState: () => invoke<boolean | null>('get_login_state'),
  playTrack: (videoId: string, playlistId?: string) => {
    // When no explicit playlist is provided, fall back to YTM's auto Song
    // Radio (`RDAMVM<videoId>`). That's the same list the navigation URL
    // uses to keep YTM in audio mode — surfacing it as the active playlist
    // means /next returns the radio queue YTM is actually playing, so the
    // Playing-queue panel never goes empty for a "single track" play.
    const effectivePlaylist =
      playlistId ?? (videoId ? `RDAMVM${videoId}` : null);
    setActivePlaylistId(effectivePlaylist);
    return invoke('play_track', {
      videoId,
      playlistId: playlistId ?? null,
    });
  },
  addToQueue: (track: TrackInfo) => invoke('add_to_queue', { track }),
  removeFromQueue: (index: number) => invoke('remove_from_queue', { index }),
  clearQueue: () => invoke('clear_queue'),
  toggleLike: () => invoke('toggle_like'),
  toggleShuffle: () => invoke('toggle_shuffle'),
  setRepeat: (mode: RepeatMode) => invoke('set_repeat', { mode }),
  cycleRepeat: () => invoke('cycle_repeat'),
};

export const ytmApi = {
  hideYtm: () => invoke('hide_ytm'),
  showYtm: () => invoke('show_ytm'),
  injectBridge: () => invoke('inject_ytm_bridge'),
};

export interface AppSettings {
  general: {
    closeToTray: boolean;
    backgroundPlayback: boolean;
  };
  integrations: {
    notificationsEnabled: boolean;
  };
  shortcuts: {
    playPause: string;
    nextTrack: string;
    prevTrack: string;
  };
}

export const settingsApi = {
  get: () => invoke<AppSettings>('get_settings'),
  set: (settings: AppSettings) => invoke<void>('set_settings', { new: settings }),
};

export const browseApi = {
  search: (query: string, filter?: string) => invoke<SearchResults>('search', { query, filter: filter ?? null }),
  searchSuggestions: (query: string) => invoke<string[]>('search_suggestions', { query }),
  getHome: () => invoke<Shelf[]>('get_home'),
  getExplore: () => invoke<Shelf[]>('get_explore'),
  getPlaylist: (playlistId: string) => invoke<PlaylistDetail>('get_playlist', { playlistId }),
  getLibraryPlaylists: () => invoke<PlaylistSummary[]>('get_library_playlists'),
  getLibrarySongs: () => invoke<TrackInfo[]>('get_library_songs'),
  getLibraryAlbums: () => invoke<AlbumSummary[]>('get_library_albums'),
  getLibraryArtists: () => invoke<ArtistSummary[]>('get_library_artists'),
  savePlaylistToLibrary: (playlistId: string) =>
    invoke<void>('save_playlist_to_library', { playlistId }),
  removePlaylistFromLibrary: (playlistId: string) =>
    invoke<void>('remove_playlist_from_library', { playlistId }),
  getLyrics: (params: {
    videoId: string;
    artist?: string | null;
    title?: string | null;
    durationSecs?: number | null;
  }) =>
    invoke<Lyrics>('get_lyrics', {
      videoId: params.videoId,
      artist: params.artist ?? null,
      title: params.title ?? null,
      durationSecs: params.durationSecs ?? null,
    }),
  getUpcomingTracks: (videoId: string, limit = 3, playlistId?: string | null) =>
    invoke<TrackInfo[]>('get_upcoming_tracks', {
      videoId,
      limit,
      playlistId: playlistId ?? null,
    }),
};

export async function playFirstFromPlaylist(playlistId: string): Promise<void> {
  const detail = await browseApi.getPlaylist(playlistId);
  if (detail.tracks.length > 0 && detail.tracks[0].videoId) {
    // Albums use an MPRE browseId that YTM doesn't accept as a `&list=`
    // watch parameter; swap to the matching OLAK audioPlaylistId. For
    // anything else (PL/OLAK/RDCLAK/LM/etc.) the input is already a valid
    // watch list — DON'T substitute audioPlaylistId because that field can
    // be a recommendation/radio playlist extracted from elsewhere in the
    // response and switching to it would land us on the wrong queue.
    const isAlbumBrowseId = playlistId.startsWith('MPRE');
    const watchList =
      isAlbumBrowseId && detail.audioPlaylistId
        ? detail.audioPlaylistId
        : playlistId;
    await playerApi.playTrack(detail.tracks[0].videoId, watchList);
  }
}
