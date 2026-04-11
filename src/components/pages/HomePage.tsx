import { type FC, useEffect, useState } from 'react';
import type { Shelf } from '../../lib/types';
import { browseApi } from '../../lib/ipc';
import { ShelfRow } from '../browse/ShelfRow';
import { AlbumCard } from '../browse/AlbumCard';
import { SongRow } from '../browse/SongRow';

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export const HomePage: FC = () => {
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    browseApi
      .getHome()
      .then((data) => {
        if (!cancelled) {
          setShelves(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <section
      style={{
        padding: 'var(--space-8) var(--space-6)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          marginBottom: 'var(--space-6)',
          letterSpacing: '-0.02em',
          color: 'var(--color-text-primary)',
        }}
      >
        {getGreeting()}
      </h1>

      {shelves.map((shelf) => (
        <ShelfRow key={shelf.title} title={shelf.title}>
          {renderShelfContent(shelf)}
        </ShelfRow>
      ))}
    </section>
  );
};

function renderShelfContent(shelf: Shelf): React.ReactNode {
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
                // TODO: navigate to album detail page when implemented
                console.debug('[VibeYTM] Album clicked:', album.browseId, album.title);
              }}
            />
          ))}
        </div>
      );

    case 'Songs':
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.data.map((track, i) => (
            <SongRow key={track.videoId} track={track} index={i + 1} />
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
            />
          ))}
        </div>
      );

    default:
      return null;
  }
}
