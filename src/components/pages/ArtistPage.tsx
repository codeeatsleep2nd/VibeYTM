import { type FC, useEffect, useState } from 'react';
import type { AlbumSummary, TrackInfo } from '../../lib/types';
import { browseApi, playerApi } from '../../lib/ipc';
import { debug } from '../../lib/debug';
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
const SEARCH_FILTER_ARTISTS = 'EgWKAQIgAWoSEA4QCRAKEAUQBBADEBUQEBAR';

const TOP_SONGS_DISPLAY_LIMIT = 8;
// Bio fetch failures (no channelId, empty description, network error)
// are silently downgraded to "no bio shown" — the existing songs/albums
// shelves still render. We never surface a bio-specific error toast.

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
  const [bio, setBio] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSongs([]);
    setAlbums([]);
    setBio('');

    // Songs + albums are the page's load-bearing data — `setIsLoading`
    // gates on these two only. The bio fetch (artist-search →
    // get_artist, ~2× slower) runs INDEPENDENTLY and updates `bio`
    // when it lands. Earlier this group was stitched into a single
    // `Promise.all`, which held back the songs/albums UI until the
    // bio resolved — directly contradicting the "doesn't lengthen
    // the load" intent flagged in code review (issue #79 follow-up).
    Promise.all([
      browseApi.search(artistName, SEARCH_FILTER_SONGS),
      browseApi.search(artistName, SEARCH_FILTER_ALBUMS),
    ])
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
        debug.error('ArtistPage', 'load failed', e);
      });

    // Issue #79 — artist bio. Runs OUT-OF-BAND from the songs/albums
    // load: the page becomes interactive as soon as those resolve,
    // and the About block fades in (or stays absent) when the bio
    // pipeline finishes later. Inner `cancelled` guard avoids firing
    // get_artist after a navigate-away even when the artist-search
    // resolved before the user left.
    browseApi
      .search(artistName, SEARCH_FILTER_ARTISTS)
      .then((res) => {
        if (cancelled) return '';
        const match = res.artists.find((a) =>
          matchesArtist(a.name, artistName),
        );
        if (!match?.channelId) return '';
        return browseApi
          .getArtist(match.channelId)
          .then((d) => (cancelled ? '' : d.description.trim()))
          .catch((e) => {
            debug.error('ArtistPage', 'getArtist failed', e);
            return '';
          });
      })
      .catch((e) => {
        debug.error('ArtistPage', 'artist-search for bio failed', e);
        return '';
      })
      .then((bioText) => {
        if (cancelled) return;
        if (typeof bioText === 'string') setBio(bioText);
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
          backdropFilter: 'var(--page-sticky-blur)',
          WebkitBackdropFilter: 'var(--page-sticky-blur)',
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
      {/* Issue #94 — bio sits at the TOP of the content area, ahead of
          everything else (including the loading-state skeletons). This
          matches Apple Music's artist-page layout: hero → about →
          songs → albums. Decoupled from `isLoading` because the bio
          fetch (#79) runs out-of-band from the songs/albums load and
          resolves on its own timeline. */}
      {bio.length > 0 && <ArtistBio text={bio} />}

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
 * Bio block — sits between the hero and the Top Songs shelf.
 * YTM artist descriptions are often long (sometimes 1000+ chars); we
 * collapse to ~300 chars by default and reveal the full text behind a
 * "Show more / Show less" toggle so the page doesn't push everything
 * else below the fold.
 */
const BIO_PREVIEW_CHARS = 300;

const ArtistBio: FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > BIO_PREVIEW_CHARS;
  const visible =
    !isLong || expanded ? text : text.slice(0, BIO_PREVIEW_CHARS).trimEnd() + '…';
  return (
    <section>
      <h2
        style={{
          fontSize: 'var(--text-lg)',
          margin: '0 0 var(--space-3) 0',
          color: 'var(--color-text-primary)',
        }}
      >
        About
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: 'var(--text-sm)',
          lineHeight: 1.6,
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {visible}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: 'var(--space-2)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-accent)',
            cursor: 'pointer',
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
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
