import { type FC, useState, useEffect, useRef } from 'react';
import type { SearchResults } from '../../lib/types';
import { browseApi } from '../../lib/ipc';
import { SongRow } from '../browse/SongRow';
import { AlbumCard } from '../browse/AlbumCard';
import { ShelfRow } from '../browse/ShelfRow';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export const SearchPage: FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (query.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    timerRef.current = setTimeout(() => {
      browseApi
        .search(query)
        .then((data) => {
          setResults(data);
          setIsLoading(false);
        })
        .catch(() => {
          setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [query]);

  return (
    <section
      style={{
        padding: 'var(--space-8) var(--space-6)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <div
        style={{
          position: 'relative',
          maxWidth: '480px',
          marginBottom: 'var(--space-8)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 'var(--space-3)',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-tertiary)',
            pointerEvents: 'none',
          }}
        >
          &#x2315;
        </span>
        <input
          type="text"
          placeholder="Search YouTube Music"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            padding:
              'var(--space-3) var(--space-4) var(--space-3) var(--space-10)',
            background: 'var(--color-surface-2)',
            border: '1px solid oklch(100% 0 0 / 0.08)',
            borderRadius: 'var(--radius-full)',
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-primary)',
            outline: 'none',
            transition: `border-color var(--duration-fast) var(--ease-out)`,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-accent)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'oklch(100% 0 0 / 0.08)';
          }}
        />
      </div>

      {isLoading && (
        <p
          style={{
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          Searching...
        </p>
      )}

      {!isLoading && !results && (
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
            Search YouTube Music
          </p>
        </div>
      )}

      {!isLoading && results && (
        <>
          {results.songs.length > 0 && (
            <ShelfRow title="Songs">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {results.songs.map((track) => (
                  <SongRow key={track.videoId} track={track} />
                ))}
              </div>
            </ShelfRow>
          )}

          {results.albums.length > 0 && (
            <ShelfRow title="Albums">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '20px',
                }}
              >
                {results.albums.map((album) => (
                  <AlbumCard
                    key={album.browseId}
                    artworkUrl={album.artworkUrl}
                    title={album.title}
                    subtitle={album.artist}
                  />
                ))}
              </div>
            </ShelfRow>
          )}

          {results.artists.length > 0 && (
            <ShelfRow title="Artists">
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-5)',
                  overflowX: 'auto',
                  paddingBottom: 'var(--space-2)',
                }}
              >
                {results.artists.map((artist) => (
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
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
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
            </ShelfRow>
          )}
        </>
      )}
    </section>
  );
};
