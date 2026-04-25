import { type FC, useEffect, useState } from 'react';
import type {
  PlaylistSummary,
  TrackInfo,
  AlbumSummary,
  ArtistSummary,
} from '../../lib/types';
import { browseApi, playFirstFromPlaylist } from '../../lib/ipc';
import { readCache, writeCache } from '../../lib/persistentCache';
import { AlbumCard } from '../browse/AlbumCard';
import { SongRow } from '../browse/SongRow';
import { LoadingSpinner, ReloadOverlay } from '../LoadingOverlay';

// Per-tab persistence keys for the 7-day localStorage cache. Library
// summaries (playlistId / browseId / channelId / videoId) drive card
// click handlers, so persisting the last-known-good list means the
// grid renders instantly with clickable cards on cold restart while a
// background refresh updates anything that's changed.
const PERSIST_KEYS = {
  playlists: 'library:playlists',
  songs: 'library:songs',
  albums: 'library:albums',
  artists: 'library:artists',
} as const;

export type LibraryTab = 'playlists' | 'songs' | 'albums' | 'artists';

interface LibraryPageProps {
  activeTab: LibraryTab;
  onOpenPlaylist?: (playlistId: string) => void;
  onAutoPlayPlaylist?: (playlistId: string) => void;
  onSearchArtist?: (name: string) => void;
  /**
   * Bumped by the parent whenever a save/remove succeeds elsewhere in the
   * app. Including it in the fetch effect's deps forces a refetch so the
   * underlying mounted LibraryPage doesn't show a removed playlist when
   * the user closes the playlist-detail overlay.
   */
  refreshKey?: number;
}

const TAB_TITLES: Record<LibraryTab, string> = {
  playlists: 'Playlists',
  songs: 'Songs',
  albums: 'Albums',
  artists: 'Artists',
};

export const LibraryPage: FC<LibraryPageProps> = ({
  activeTab,
  onOpenPlaylist,
  onSearchArtist,
  refreshKey = 0,
}) => {
  // Hydrate from localStorage so the grid is interactive on the first
  // render. The fetchData effect below will refresh from the network and
  // overwrite — this is purely a "render-while-revalidate" optimization.
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>(
    () => readCache<PlaylistSummary[]>(PERSIST_KEYS.playlists) ?? [],
  );
  const [songs, setSongs] = useState<TrackInfo[]>(
    () => readCache<TrackInfo[]>(PERSIST_KEYS.songs) ?? [],
  );
  const [albums, setAlbums] = useState<AlbumSummary[]>(
    () => readCache<AlbumSummary[]>(PERSIST_KEYS.albums) ?? [],
  );
  const [artists, setArtists] = useState<ArtistSummary[]>(
    () => readCache<ArtistSummary[]>(PERSIST_KEYS.artists) ?? [],
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const fetchData = async () => {
      try {
        switch (activeTab) {
          case 'playlists': {
            const data = await browseApi.getLibraryPlaylists();
            if (!cancelled) {
              setPlaylists(data);
              writeCache(PERSIST_KEYS.playlists, data);
            }
            break;
          }
          case 'songs': {
            const data = await browseApi.getLibrarySongs();
            if (!cancelled) {
              setSongs(data);
              writeCache(PERSIST_KEYS.songs, data);
            }
            break;
          }
          case 'albums': {
            const data = await browseApi.getLibraryAlbums();
            if (!cancelled) {
              setAlbums(data);
              writeCache(PERSIST_KEYS.albums, data);
            }
            break;
          }
          case 'artists': {
            const data = await browseApi.getLibraryArtists();
            if (!cancelled) {
              setArtists(data);
              writeCache(PERSIST_KEYS.artists, data);
            }
            break;
          }
        }
      } catch (e) {
        console.error('[LibraryPage] fetch failed:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [activeTab, refreshKey]);

  const currentTabHasData =
    (activeTab === 'playlists' && playlists.length > 0) ||
    (activeTab === 'songs' && songs.length > 0) ||
    (activeTab === 'albums' && albums.length > 0) ||
    (activeTab === 'artists' && artists.length > 0);

  if (isLoading && !currentTabHasData) {
    return <LoadingSpinner />;
  }

  const content = (
    <section
      style={{
        padding: '0 var(--space-6) var(--space-8)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--color-surface-1)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          // Line the library title up with the sidebar's Library group
          // headings (issue #59).
          paddingTop: 'var(--space-3)',
          paddingBottom: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}
      >
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: 'var(--color-text-primary)',
          margin: 0,
        }}
      >
        {TAB_TITLES[activeTab]}
      </h1>
      </div>

      {activeTab === 'playlists' && (
        <>
          {playlists.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '20px',
              }}
            >
              {playlists.map((playlist) => (
                <AlbumCard
                  key={playlist.playlistId}
                  artworkUrl={playlist.artworkUrl}
                  title={playlist.title}
                  subtitle={
                    playlist.trackCount != null
                      ? `${playlist.trackCount} tracks`
                      : ''
                  }
                  onClick={() => onOpenPlaylist?.(playlist.playlistId)}
                  onPlay={() => {
                    playFirstFromPlaylist(playlist.playlistId);
                    onOpenPlaylist?.(playlist.playlistId);
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptyState label="playlists" />
          )}
        </>
      )}

      {activeTab === 'songs' && (
        <>
          {songs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {songs.map((track, i) => (
                <SongRow key={track.videoId || `song-${i}`} track={track} index={i + 1} />
              ))}
            </div>
          ) : (
            <EmptyState label="liked songs" />
          )}
        </>
      )}

      {activeTab === 'albums' && (
        <>
          {albums.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '20px',
              }}
            >
              {albums.map((album) => (
                <AlbumCard
                  key={album.browseId}
                  artworkUrl={album.artworkUrl}
                  title={album.title}
                  subtitle={album.artist}
                  onClick={() => {
                    if (album.browseId) {
                      onOpenPlaylist?.(album.browseId);
                    }
                  }}
                  onPlay={() => {
                    if (album.browseId) {
                      playFirstFromPlaylist(album.browseId);
                      onOpenPlaylist?.(album.browseId);
                    }
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptyState label="liked albums" />
          )}
        </>
      )}

      {activeTab === 'artists' && (
        <>
          {artists.length > 0 ? (
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-5)',
                flexWrap: 'wrap',
                paddingBottom: 'var(--space-2)',
              }}
            >
              {artists.map((artist) => (
                <button
                  key={artist.channelId}
                  type="button"
                  onClick={() => onSearchArtist?.(artist.name)}
                  aria-label={`Search for ${artist.name}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    width: '120px',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: '100px',
                      height: '100px',
                      borderRadius: 'var(--radius-full)',
                      overflow: 'hidden',
                      background: 'var(--color-surface-2)',
                    }}
                  >
                    {artist.avatarUrl && (
                      <img
                        src={artist.avatarUrl}
                        alt={artist.name}
                        loading="lazy"
                        width={100}
                        height={100}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-secondary)',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      width: '100%',
                    }}
                  >
                    {artist.name}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState label="artists" />
          )}
        </>
      )}
    </section>
  );

  return isLoading ? <ReloadOverlay>{content}</ReloadOverlay> : content;
};

const EmptyState: FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '200px',
    }}
  >
    <p
      style={{
        fontSize: 'var(--text-base)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      No {label} found in your library
    </p>
  </div>
);
