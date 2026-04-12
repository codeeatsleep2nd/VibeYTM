import { type FC, useCallback, useEffect, useState } from 'react';
import type { Shelf } from '../../lib/types';
import { browseApi, playFirstFromPlaylist } from '../../lib/ipc';
import { ShelfRow } from '../browse/ShelfRow';
import { AlbumCard } from '../browse/AlbumCard';
import { SongRow } from '../browse/SongRow';

interface ExplorePageProps {
  onOpenPlaylist?: (playlistId: string) => void;
  onAutoPlayPlaylist?: (playlistId: string) => void;
}

export const ExplorePage: FC<ExplorePageProps> = ({ onOpenPlaylist }) => {
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExplore = useCallback(() => {
    setIsLoading(true);
    setError(null);
    browseApi
      .getExplore()
      .then((data) => {
        setShelves(data);
        setIsLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchExplore();
  }, [fetchExplore]);

  if (isLoading) {
    return (
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-text-tertiary)',
          fontSize: 'var(--text-base)',
        }}
      >
        Loading...
      </section>
    );
  }

  if (error) {
    return (
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 'var(--space-4)',
        }}
      >
        <p
          style={{
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          Failed to load explore content
        </p>
        <button
          onClick={fetchExplore}
          style={{
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-1) var(--space-3)',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
          }}
        >
          Retry
        </button>
      </section>
    );
  }

  return (
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 'var(--space-8)',
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
          Explore
        </h1>
        <button
          onClick={fetchExplore}
          style={{
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-1) var(--space-3)',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {shelves.map((shelf) => (
        <ShelfRow key={shelf.title} title={shelf.title}>
          {renderShelfContent(shelf, onOpenPlaylist)}
        </ShelfRow>
      ))}

      {shelves.length === 0 && (
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
            No explore content available
          </p>
        </div>
      )}
    </section>
  );
};

function renderShelfContent(
  shelf: Shelf,
  onOpenPlaylist?: (playlistId: string) => void,
): React.ReactNode {
  const { items } = shelf;

  switch (items.kind) {
    case 'Albums':
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '20px',
          }}
        >
          {items.data.map((album) => (
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
      );

    case 'Songs':
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            columnGap: 'var(--space-4)',
            rowGap: 'var(--space-1)',
          }}
        >
          {items.data.map((track, i) => (
            <SongRow key={track.videoId || `song-${i}`} track={track} />
          ))}
        </div>
      );

    case 'Artists':
      return (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-5)',
            overflowX: 'auto',
            paddingBottom: 'var(--space-2)',
          }}
        >
          {items.data.map((artist) => (
            <div
              key={artist.channelId}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-2)',
                flexShrink: 0,
                width: '120px',
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
                <img
                  src={artist.avatarUrl}
                  alt={artist.name}
                  loading="lazy"
                  width={100}
                  height={100}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
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
            </div>
          ))}
        </div>
      );

    case 'Playlists':
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '20px',
          }}
        >
          {items.data.map((playlist) => (
            <AlbumCard
              key={playlist.playlistId}
              artworkUrl={playlist.artworkUrl}
              title={playlist.title}
              subtitle={
                playlist.trackCount !== undefined
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
      );

    default:
      return null;
  }
}
