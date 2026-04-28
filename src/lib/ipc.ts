import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { AccountInfo, PlayerState, TrackInfo, SearchResults, Shelf, PlaylistSummary, PlaylistDetail, AlbumSummary, ArtistSummary, PodcastSummary, PodcastLastEpisode, Lyrics } from './types';
import type { RepeatMode } from './types';

export interface CacheStats {
  image_count: number;
  image_bytes: number;
  track_count: number;
  track_bytes: number;
  lyric_count: number;
  lyric_bytes: number;
  total_bytes: number;
  max_bytes: number;
}

export const cacheApi = {
  fetchImage: (url: string) => invoke<string>('cache_fetch_image', { url }),
  clear: () => invoke<number>('cache_clear'),
  stats: () => invoke<CacheStats>('cache_stats'),
  convertToAssetUrl: (path: string) => convertFileSrc(path),
  /**
   * Build a `vibeytm-cache://` URL the webview can use as an `<img src>`
   * directly. The custom URI scheme handler in
   * `src-tauri/src/protocols/cache_image.rs` resolves it through the
   * same disk cache `cache_fetch_image` uses, but without the
   * JS↔Rust IPC + `convertFileSrc` round trip — so home-page mounts
   * with 100+ thumbnails no longer back up against the IPC bridge.
   */
  buildCacheUrl: (url: string): string =>
    `vibeytm-cache://localhost/?u=${encodeURIComponent(url)}`,
};

export interface AboutInfo {
  version: string;
  tagline: string;
  built_with: string;
  visit_prefix: string;
  visit_suffix: string;
  website_url: string;
  website_label: string;
}

export const aboutApi = {
  get: () => invoke<AboutInfo>('get_about_info'),
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

/**
 * Bootstrap the module-level activePlaylistId from a restored PlayerState
 * (called once on app startup after `playerApi.getState()` returns the
 * persisted session). Idempotent — only fires when the value actually
 * changes from its current value.
 */
export function bootstrapActivePlaylistFromState(state: PlayerState): void {
  // `activePlaylistId` is already declared on `PlayerState` (lib/types.ts);
  // no widening cast needed. Reading it directly preserves the type-checker's
  // ability to flag a future removal of the field.
  if (state.activePlaylistId !== undefined) {
    setActivePlaylistId(state.activePlaylistId ?? null);
  }
}

// --- Predicted-track overlay -------------------------------------------
//
// When the user clicks Next/Previous (or any synchronous "play this
// specific track" button), we know the FULL track metadata immediately
// — long before the IPC round-trip / Rust placeholder / bridge poller
// can update `usePlayerState`'s shared `track`. Set it here and any
// React subscriber can read it as a synchronous override so the queue
// panel's now-playing row + playing-bars animation land on the new
// track on the same frame as the click.
//
// Cleared automatically when `usePlayerState`'s real track catches up
// to the predicted videoId.

let predictedTrack: TrackInfo | null = null;
type PredictedTrackListener = (track: TrackInfo | null) => void;
const predictedTrackListeners = new Set<PredictedTrackListener>();

export function getPredictedTrack(): TrackInfo | null {
  return predictedTrack;
}

export function setPredictedTrack(track: TrackInfo | null): void {
  if (
    predictedTrack === track ||
    (predictedTrack && track && predictedTrack.videoId === track.videoId)
  ) {
    return;
  }
  predictedTrack = track;
  for (const listener of predictedTrackListeners) listener(track);
}

export function subscribePredictedTrack(
  listener: PredictedTrackListener,
): () => void {
  predictedTrackListeners.add(listener);
  return () => {
    predictedTrackListeners.delete(listener);
  };
}

// --- Visible queue planner ---------------------------------------------
//
// QueuePanel computes its visible Up-Next list (after freeze + dedup +
// slicing) and writes it here. PlayerBar's Next/Previous buttons read
// this so they navigate to whatever the user is actually seeing rather
// than handing control to YTM's `nextVideo()`, whose internal queue can
// drift from ours when its song-radio regenerates.

let plannedUpcoming: TrackInfo[] = [];
let plannedHistory: TrackInfo[] = [];

export function setPlannedQueue(history: TrackInfo[], upcoming: TrackInfo[]): void {
  plannedHistory = history;
  plannedUpcoming = upcoming;
}

export function getPlannedNext(): TrackInfo | null {
  return plannedUpcoming[0] ?? null;
}

export function getPlannedPrevious(): TrackInfo | null {
  return plannedHistory.length > 0
    ? plannedHistory[plannedHistory.length - 1]
    : null;
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
    /**
     * Last user-set volume in [0.0, 1.0]. Persisted server-side so it
     * survives restarts and is re-pushed into YTM whenever the audio
     * webview navigates and resets its <video> element. Mirrors the
     * Rust `GeneralSettings.last_volume` field — must be present here
     * so spread updates (e.g. closeToTray toggle) round-trip through
     * `set_settings` without losing the volume.
     */
    lastVolume: number;
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

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  updateAvailable: boolean;
}

export const updateApi = {
  check: () => invoke<UpdateInfo>('check_for_updates'),
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
  getLibraryPodcasts: () => invoke<PodcastSummary[]>('get_library_podcasts'),
  getPodcastLastEpisode: (browseId: string) =>
    invoke<PodcastLastEpisode | null>('get_podcast_last_episode', { browseId }),
  savePlaylistToLibrary: (playlistId: string) =>
    invoke<void>('save_playlist_to_library', { playlistId }),
  removePlaylistFromLibrary: (playlistId: string) =>
    invoke<void>('remove_playlist_from_library', { playlistId }),
  getLyrics: (params: {
    videoId: string;
    artist?: string | null;
    title?: string | null;
    durationSecs?: number | null;
    /** Bypass disk cache + YTM-synced short-circuit; force LRCLIB/NetEase
     *  race. Used by the Refresh button when YTM has wrong lyrics. */
    forceExternal?: boolean;
  }) =>
    invoke<Lyrics>('get_lyrics', {
      videoId: params.videoId,
      artist: params.artist ?? null,
      title: params.title ?? null,
      durationSecs: params.durationSecs ?? null,
      forceExternal: params.forceExternal ?? false,
    }),
  invalidateLyricsCache: (videoId: string) =>
    invoke<void>('invalidate_lyrics_cache', { videoId }),
  getUpcomingTracks: (videoId: string, limit = 3, playlistId?: string | null) =>
    invoke<TrackInfo[]>('get_upcoming_tracks', {
      videoId,
      limit,
      playlistId: playlistId ?? null,
    }),
  /**
   * For tracks that have both a music-video and an audio counterpart on
   * YTM, return the audio counterpart's album-art URL. Used by
   * `useAudioCounterpartArtwork` to swap the music-video 16:9 frame
   * the bridge captured for the song's square album cover. `null` when
   * the track has no counterpart (already the audio side, or YTM
   * hasn't matched it).
   */
  getAudioCounterpartArtwork: (videoId: string) =>
    invoke<string | null>('get_audio_counterpart_artwork', { videoId }),
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
