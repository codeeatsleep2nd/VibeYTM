export interface TrackInfo {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  artworkUrl?: string;
  durationSecs: number;
}

export type PlaybackStatus = 'playing' | 'paused' | 'buffering' | 'idle';

export type RepeatMode = 'none' | 'one' | 'all';

export interface AccountInfo {
  name: string;
  avatarUrl: string;
}

export interface PlayerState {
  status: PlaybackStatus;
  track: TrackInfo | null;
  positionSecs: number;
  volume: number;
  isLiked: boolean;
  repeatMode: RepeatMode;
  isShuffled: boolean;
  queue: TrackInfo[];
  /** Restored from last session on launch; updated whenever the user
   *  explicitly starts playing from a playlist/album/radio. */
  activePlaylistId?: string | null;
  account: AccountInfo | null;
}

export interface AlbumSummary {
  browseId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  // Wire format is a display string ("2019", "2024"), not a number — YTM
  // returns it as a free-form string and the Rust mirror is `Option<String>`.
  // Don't switch this to `number` without updating the Rust parser to emit
  // u16 — otherwise consumers that do arithmetic silently get NaN.
  year?: string;
}

export interface ArtistSummary {
  channelId: string;
  name: string;
  avatarUrl: string;
  subscriberCount?: string;
}

export interface PlaylistSummary {
  playlistId: string;
  title: string;
  artworkUrl: string;
  trackCount?: number;
}

export interface PlaylistDetail {
  playlistId: string;
  title: string;
  description?: string;
  artworkUrl: string;
  trackCount?: number;
  tracks: TrackInfo[];
  /** Whether the current user already has this in their library. */
  isInLibrary?: boolean;
  /** Playable playlist ID for library operations (OLAK* for albums). */
  audioPlaylistId?: string | null;
  /** True when this detail represents an album (MPRE browseId). */
  isAlbum?: boolean;
}

export interface SearchResults {
  songs: TrackInfo[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
  /**
   * First real album surfaced from an unfiltered search response. Used by the
   * unified search view to render an AlbumCard hero with a 3-track preview.
   * Null when no album was found or the search was filtered.
   */
  topAlbum?: AlbumSummary | null;
}

export type ShelfContent =
  | { kind: 'Albums'; data: AlbumSummary[] }
  | { kind: 'Playlists'; data: PlaylistSummary[] }
  | { kind: 'Songs'; data: TrackInfo[] }
  | { kind: 'Artists'; data: ArtistSummary[] };

export interface Shelf {
  title: string;
  items: ShelfContent;
}

export interface LyricLine {
  startMs: number;
  endMs?: number | null;
  text: string;
}

export interface Lyrics {
  text: string;
  source?: string | null;
  /** Per-line timings when YTM returned synced lyrics; else null. */
  lines?: LyricLine[] | null;
}
