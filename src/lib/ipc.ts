import { invoke } from '@tauri-apps/api/core';
import type { PlayerState, TrackInfo, SearchResults, Shelf, PlaylistSummary } from './types';
import type { RepeatMode } from './types';

export const playerApi = {
  play: () => invoke('play'),
  pause: () => invoke('pause'),
  togglePlay: () => invoke('toggle_play'),
  next: () => invoke('next_track'),
  previous: () => invoke('previous_track'),
  seek: (secs: number) => invoke('seek', { secs }),
  setVolume: (level: number) => invoke('set_volume', { level }),
  getState: () => invoke<PlayerState>('get_player_state'),
  playTrack: (videoId: string) => invoke('play_track', { videoId }),
  addToQueue: (track: TrackInfo) => invoke('add_to_queue', { track }),
  removeFromQueue: (index: number) => invoke('remove_from_queue', { index }),
  clearQueue: () => invoke('clear_queue'),
  toggleLike: () => invoke('toggle_like'),
  toggleShuffle: () => invoke('toggle_shuffle'),
  setRepeat: (mode: RepeatMode) => invoke('set_repeat', { mode }),
};

export const ytmApi = {
  hideYtm: () => invoke('hide_ytm'),
  showYtm: () => invoke('show_ytm'),
  injectBridge: () => invoke('inject_ytm_bridge'),
};

export const browseApi = {
  search: (query: string) => invoke<SearchResults>('search', { query }),
  getHome: () => invoke<Shelf[]>('get_home'),
  getLibraryPlaylists: () => invoke<PlaylistSummary[]>('get_library_playlists'),
};
