import { type FC, useEffect, useState } from 'react';
import type { AlbumSummary, SearchResults, TrackInfo } from '../../lib/types';
import { browseApi, playerApi } from '../../lib/ipc';
import { rememberTrackArtworks } from '../../lib/trackArtworkRegistry';
import { SongRow } from '../browse/SongRow';
import { AlbumCard } from '../browse/AlbumCard';
import { LoadingSpinner } from '../LoadingOverlay';

interface ArtistPageProps {
  /** Artist's display name. The page runs YTM searches scoped to this
   *  string for songs + albums. Reduces to existing infra so we don't
   *  need a new artist-specific YTM browse endpoint. */
  artistName: string;
  onBack: () => void;
  onOpenAlbum?: (browseId: string) => void;
}

// Same encoded category filters SearchPage uses. Kept inline so the
// page is self-contained and survives any future refactor of
// SearchPage's constants.
const SEARCH_FILTER_SONGS = 'EgWKAQIIAWoSEA4QCRAKEAUQBBADEBUQEBAR';
const SEARCH_FILTER_ALBUMS = 'EgWKAQIYAWoSEA4QCRAKEAUQBBADEBUQEBAR';

const TOP_SONGS_DISPLAY_LIMIT = 8;

/**
 * Artist landing page — name, top songs, top albums. Replaces the
 * previous "go to artist" → search redirect, which dumped users on
 * the unstructured search results page. Scoped to what the existing
 * YTM browse layer can deliver without a new endpoint:
 *
 *   - Songs shelf via `search(artistName, SONGS_FILTER)`
 *   - Albums shelf via `search(artistName, ALBUMS_FILTER)`
 *   - "Play All" runs the first track and lets YTM's auto-radio fill
 *     the queue from the rest.
 *
 * A future iteration can replace this with a real artist-browse IPC
 * once we add the YTM `browse?browseId=UC...` parser. For now this
 * gets users out of the search-redirect ugly UX without a Rust
 * dependency change.
 */
export const ArtistPage: FC<ArtistPageProps> = ({
  artistName,
  onBack,
  onOpenAlbum,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [songs, setSongs] = useState<TrackInfo[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSongs([]);
    setAlbums([]);

    const songsPromise: Promise<SearchResults> = browseApi.search(
      artistName,
      SEARCH_FILTER_SONGS,
    );
    const albumsPromise: Promise<SearchResults> = browseApi.search(
      artistName,
      SEARCH_FILTER_ALBUMS,
    );

    Promise.all([songsPromise, albumsPromise])
      .then(([songsRes, albumsRes]) => {
        if (cancelled) return;
        const matchedSongs = songsRes.songs.filter((t) =>
          matchesArtist(t.artist, artistName),
        );
        rememberTrackArtworks(matchedSongs);
        setSongs(matchedSongs.slice(0, TOP_SONGS_DISPLAY_LIMIT));
        setAlbums(albumsRes.albums.filter((a) => matchesArtist(a.artist, artistName)));
        setIsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`Could not load ${artistName}`);
        setIsLoading(false);
        console.error('[ArtistPage] load failed:', e);
      });

    return () => {
      cancelled = true;
    };
  }, [artistName]);

  const handlePlayAll = () => {
    const first = songs[0];
    if (!first?.videoId) return;
    void playerApi.playTrack(first.videoId).catch(() => {});
  };

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        padding: 'var(--space-6)',
        gap: 'var(--space-6)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-surface-2)',
            color: 'var(--color-text-primary)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--text-base)',
          }}
        >
          {'←'}
        </button>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--text-2xl)',
            letterSpacing: '-0.02em',
            color: 'var(--color-text-primary)',
          }}
        >
          {artistName}
        </h1>
        {songs.length > 0 && (
          <button
            type="button"
            onClick={handlePlayAll}
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--color-accent)',
              color: 'oklch(100% 0 0)',
              border: 'none',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {'▶'} Play
          </button>
        )}
      </header>

      {isLoading && (
        <div style={{ height: 240 }}>
          <LoadingSpinner />
        </div>
      )}

      {error && !isLoading && (
        <p
          style={{
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-base)',
          }}
        >
          {error}
        </p>
      )}

      {!isLoading && !error && songs.length === 0 && albums.length === 0 && (
        <p
          style={{
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-base)',
          }}
        >
          No songs or albums found for {artistName}.
        </p>
      )}

      {!isLoading && songs.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 'var(--text-lg)',
              margin: '0 0 var(--space-3) 0',
              color: 'var(--color-text-primary)',
            }}
          >
            Top songs
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {songs.map((track, idx) => (
              <SongRow
                key={`${track.videoId || 'track'}-${idx}`}
                track={track}
              />
            ))}
          </div>
        </section>
      )}

      {!isLoading && albums.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 'var(--text-lg)',
              margin: '0 0 var(--space-3) 0',
              color: 'var(--color-text-primary)',
            }}
          >
            Albums
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            {albums.map((album, idx) => (
              <AlbumCard
                key={`${album.browseId || 'album'}-${idx}`}
                artworkUrl={album.artworkUrl}
                title={album.title}
                subtitle={album.year ?? album.artist}
                onClick={() =>
                  album.browseId ? onOpenAlbum?.(album.browseId) : undefined
                }
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
};

/**
 * Loose case-insensitive substring match between a track/album's artist
 * field and the page's artist name. Covers "Fleetwood Mac" matching
 * "Fleetwood Mac & Stevie Nicks" while filtering out unrelated results
 * that the YTM search blends in (covers, similar artists, etc.).
 */
function matchesArtist(field: string, target: string): boolean {
  if (!field || !target) return false;
  return field.toLowerCase().includes(target.toLowerCase());
}
