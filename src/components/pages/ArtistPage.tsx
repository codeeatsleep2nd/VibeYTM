import { type FC, useEffect, useState } from 'react';
import type { AlbumSummary, SearchResults, TrackInfo } from '../../lib/types';
import { browseApi, playerApi } from '../../lib/ipc';
import { rememberTrackArtworks } from '../../lib/trackArtworkRegistry';
import { useCoverColors } from '../../hooks/useCoverColors';
import { albumArtOrNothing } from '../../lib/artwork';
import { SongRow } from '../browse/SongRow';
import { AlbumCard } from '../browse/AlbumCard';
import { LoadingSpinner } from '../LoadingOverlay';
import { DetailPageHero } from '../DetailPageHero';
import { SkeletonRow, SkeletonCard } from '../Skeleton';

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

  // Pull the cover from the first matched track / album so the hero
  // gets a real palette to extract. Falls through to undefined when
  // nothing is loaded yet — the hook returns a neutral fallback.
  const heroCover =
    albumArtOrNothing(songs[0]?.artworkUrl) ??
    albumArtOrNothing(albums[0]?.artworkUrl) ??
    undefined;
  const heroColors = useCoverColors(heroCover);

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      {/* Sticky hero — the cover/title block stays pinned at the top
          of the page while the songs/albums content scrolls underneath.
          Transparent background + backdrop-filter blur so scrolled
          rows show through with a frosted-glass effect. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          flexShrink: 0,
          background: 'transparent',
          backdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness))`,
          WebkitBackdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness))`,
        }}
      >
        <DetailPageHero
          title={artistName}
          kind="Artist"
          coverUrl={heroCover ?? ''}
          colors={heroColors}
          meta={
            songs.length > 0 || albums.length > 0
              ? `${songs.length} songs · ${albums.length} albums`
              : undefined
          }
          onBack={onBack}
          onPlay={handlePlayAll}
          transparent
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)',
          padding: 'var(--space-6)',
        }}
      >
      {isLoading && (
        <>
          <section>
            <div
              style={{
                fontSize: 'var(--text-lg)',
                margin: '0 0 var(--space-3) 0',
                color: 'var(--color-text-tertiary)',
              }}
            >
              Top songs
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                columnGap: 'var(--space-4)',
                rowGap: 'var(--space-1)',
              }}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          </section>
          <section>
            <div
              style={{
                fontSize: 'var(--text-lg)',
                margin: '0 0 var(--space-3) 0',
                color: 'var(--color-text-tertiary)',
              }}
            >
              Albums
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
                gap: 'var(--space-4)',
              }}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </section>
        </>
      )}
      {/* LoadingSpinner kept for indeterminate cases (none currently). */}
      {false && <LoadingSpinner />}

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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              columnGap: 'var(--space-4)',
              rowGap: 'var(--space-1)',
            }}
          >
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
      </div>
    </section>
  );
};

/**
 * Loose case-insensitive match between a track/album's artist field and
 * the page's artist name. Tolerant of two real-world quirks:
 *
 *   - YTM library artist names often combine native + romanized forms
 *     ("周杰倫 - Jay Chou"), but per-song artist fields only carry one
 *     ("周杰倫"). Plain `field.includes(target)` returned false because
 *     the target was *longer* than the field.
 *   - Multi-artist credits ("Fleetwood Mac & Stevie Nicks") should still
 *     match a "Fleetwood Mac" page.
 *
 * Strategy: split the target on common separators and accept the row
 * when ANY non-trivial token of the target is contained in the field
 * — and also keep the original substring check so collaborator pages
 * keep working.
 */
function matchesArtist(field: string, target: string): boolean {
  if (!field || !target) return false;
  const f = field.toLowerCase();
  const t = target.toLowerCase();
  if (f.includes(t) || t.includes(f)) return true;
  const tokens = t
    .split(/\s*[-–—&,/、|]\s*|\s+(?:feat\.?|featuring|with|x|vs\.?)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return tokens.some((tok) => f.includes(tok));
}
