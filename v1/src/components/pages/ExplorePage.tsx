import { type FC, useCallback, useEffect, useState } from 'react';
import type { Shelf } from '../../lib/types';
import { browseApi, playFirstFromPlaylist } from '../../lib/ipc';
import { readCache, writeCache } from '../../lib/persistentCache';
import { ShelfRow } from '../browse/ShelfRow';
import { AlbumCard } from '../browse/AlbumCard';
import { SongRow } from '../browse/SongRow';
import { CachedImage } from '../CachedImage';
import { LoadingSpinner, ReloadOverlay } from '../LoadingOverlay';
import { LiquidGlass } from '@liquidglass/react';

interface ExplorePageProps {
  onOpenPlaylist?: (playlistId: string) => void;
  onAutoPlayPlaylist?: (playlistId: string) => void;
}

// Module-level cache so the Explore feed survives tab-switch remounts. The
// page component is unmounted when the user navigates away, which would
// otherwise force a fresh fetch every time they return. Persisted to
// localStorage with a 7-day TTL so cold restarts render instantly from
// last-known-good data while a background refresh runs.
const PERSIST_KEY = 'explore:shelves';
let exploreCache: Shelf[] | null = readCache<Shelf[]>(PERSIST_KEY);

export const ExplorePage: FC<ExplorePageProps> = ({ onOpenPlaylist }) => {
  const [shelves, setShelves] = useState<Shelf[]>(exploreCache ?? []);
  // If we already have cached data, skip the loading spinner on remount —
  // render the cache immediately.
  const [isLoading, setIsLoading] = useState(exploreCache === null);
  // Separate flag for explicit user-triggered refreshes so the button can
  // show feedback (spin + disabled) without swapping out the whole page.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchExplore = useCallback((userInitiated = false) => {
    if (exploreCache === null) setIsLoading(true);
    if (userInitiated) setIsRefreshing(true);
    setError(null);
    browseApi
      .getExplore()
      .then((data) => {
        exploreCache = data;
        writeCache(PERSIST_KEY, data);
        setShelves(data);
        setIsLoading(false);
        setIsRefreshing(false);
      })
      .catch((e) => {
        setError(String(e));
        setIsLoading(false);
        setIsRefreshing(false);
      });
  }, []);

  useEffect(() => {
    // On remount with a warm cache, skip the network round-trip entirely.
    if (exploreCache !== null) return;
    fetchExplore();
  }, [fetchExplore]);

  const isReloading = isLoading || isRefreshing;

  if (isLoading && shelves.length === 0) {
    return <LoadingSpinner />;
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
          onClick={() => fetchExplore()}
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

  const content = (
    <section
      style={{
        padding: '0 var(--space-6)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <div style={{ height: 'var(--space-3)', flexShrink: 0 }} aria-hidden="true" />
      <div
        style={{
          position: 'sticky',
          top: 'var(--space-3)',
          zIndex: 10,
          marginBottom: 'var(--space-4)',
        }}
      >
        <LiquidGlass
          borderRadius={150}
          blur={8}
          contrast={1.2}
          brightness={1.05}
          saturation={1.1}
          shadowIntensity={0.25}
          displacementScale={1}
          elasticity={1}
          zIndex={10}
        ><div
          style={{
            width: '100%',
            padding:
              'calc(var(--title-bar-height) - var(--space-3)) var(--space-10) var(--space-3)',
            background: 'oklch(20% 0.005 270 / 0.30)',
            borderRadius: 'inherit',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
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
            onClick={() => {
              if (isRefreshing) return;
              exploreCache = null;
              fetchExplore(true);
            }}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1) var(--space-3)',
              color: 'var(--color-text-tertiary)',
              cursor: isRefreshing ? 'wait' : 'pointer',
              fontSize: 'var(--text-sm)',
              opacity: isRefreshing ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transition: 'transform var(--duration-normal) var(--ease-out)',
                animation: isRefreshing
                  ? 'vibeytm-spin 0.9s linear infinite'
                  : undefined,
              }}
            >
              ↻
            </span>
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div></LiquidGlass>
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
      <div
        style={{
          height: 'calc(var(--player-bar-height) + var(--space-6))',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
    </section>
  );

  return isReloading && shelves.length > 0 ? (
    <ReloadOverlay>{content}</ReloadOverlay>
  ) : (
    content
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
            overflowY: 'hidden',
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
                <CachedImage
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
      );

    default:
      return null;
  }
}
