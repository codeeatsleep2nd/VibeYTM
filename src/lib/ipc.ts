import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { PlayerState, TrackInfo, SearchResults, Shelf, PlaylistSummary, PlaylistDetail, AlbumSummary, ArtistSummary } from './types';
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

export const playerApi = {
  play: () => invoke('play'),
  pause: () => invoke('pause'),
  togglePlay: () => invoke('toggle_play'),
  next: () => invoke('next_track'),
  previous: () => invoke('previous_track'),
  seek: (secs: number) => invoke('seek', { secs }),
  setVolume: (level: number) => invoke('set_volume', { level }),
  getState: () => invoke<PlayerState>('get_player_state'),
  playTrack: (videoId: string, playlistId?: string) => invoke('play_track', { videoId, playlistId: playlistId ?? null }),
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
};

export async function playFirstFromPlaylist(playlistId: string): Promise<void> {
  const detail = await browseApi.getPlaylist(playlistId);
  if (detail.tracks.length > 0 && detail.tracks[0].videoId) {
    await playerApi.playTrack(detail.tracks[0].videoId, playlistId);
  }
}
