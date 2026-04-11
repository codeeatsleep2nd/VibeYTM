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

export interface PlayerState {
  status: PlaybackStatus;
  track: TrackInfo | null;
  positionSecs: number;
  volume: number;
  isLiked: boolean;
  repeatMode: RepeatMode;
  isShuffled: boolean;
  queue: TrackInfo[];
}

export interface AlbumSummary {
  browseId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  year?: number;
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

export interface SearchResults {
  songs: TrackInfo[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
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
