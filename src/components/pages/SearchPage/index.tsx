import { type FC, useEffect, useRef, useState } from 'react';
import type { AlbumSummary, PlaylistDetail, SearchResults } from '../../../lib/types';
import { browseApi, playFirstFromPlaylist } from '../../../lib/ipc';
import { SongRow } from '../../browse/SongRow';
import { AlbumCard } from '../../browse/AlbumCard';
import { ShelfRow } from '../../browse/ShelfRow';
import { CachedImage } from '../../CachedImage';

import {
  loadRecentSearches,
  pushRecentSearch,
  saveRecentSearches,
} from '../../../lib/recentSearches';

import { TopAlbumCover } from './TopAlbumCover';
import { EmptyCategory } from './EmptyCategory';
import { LiquidGlass } from '@liquidglass/react';
import { openArtist } from '../../../lib/appNav';

const SUGGEST_DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;
const MIN_SUGGEST_LENGTH = 3;
const MAX_SUGGESTIONS = 5;
const PREVIEW_TRACK_COUNT = 3;

const CATEGORY_TABS = ['Songs', 'Albums', 'Artists', 'Playlists', 'Podcasts'] as const;
type CategoryTab = (typeof CATEGORY_TABS)[number];

const CATEGORY_PARAMS: Record<CategoryTab, string | undefined> = {
  Songs: 'EgWKAQIIAWoSEA4QCRAKEAUQBBADEBUQEBAR',
  Albums: 'EgWKAQIYAWoSEA4QCRAKEAUQBBADEBUQEBAR',
  Artists: 'EgWKAQIgAWoSEA4QCRAKEAUQBBADEBUQEBAR',
  Playlists: 'EgWKAQIoAWoSEA4QCRAKEAUQBBADEBUQEBAR',
  Podcasts: 'EgWKAQJQAWoSEA4QCRAKEAUQBBADEBUQEBAR',
};

interface SearchPageProps {
  onOpenPlaylist?: (playlistId: string) => void;
  onAutoPlayPlaylist?: (playlistId: string) => void;
  pendingQuery?: string | null;
  onPendingQueryConsumed?: () => void;
}

const cacheKey = (q: string, cat: CategoryTab | null): string =>
  `${q.trim().toLowerCase()}|${cat ?? 'all'}`;

export const SearchPage: FC<SearchPageProps> = ({
  onOpenPlaylist,
  pendingQuery,
  onPendingQueryConsumed,
}) => {
  // `query` = current text in the input. `submittedQuery` = last query the
  // user actually committed (Enter or clicked a suggestion). Searches fire
  // off the latter only.
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // null = no tab selected → unified default view
  const [activeCategory, setActiveCategory] = useState<CategoryTab | null>(null);

  // Persisted MRU list of submitted queries; rendered as quick-tap chips
  // before the user runs any search this session.
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    loadRecentSearches(),
  );

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // -1 = no highlight; 0..N-1 selects the corresponding suggestion.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Lazy-fetched 3-track preview for the top album in the unified view.
  const [topAlbumPreview, setTopAlbumPreview] = useState<PlaylistDetail | null>(null);
  // Becomes true once the top album cover image has fully decoded; until
  // then the entire Top result block stays hidden so it never appears
  // half-loaded.
  const [topCoverReady, setTopCoverReady] = useState(false);

  // Caches survive re-renders so toggling tabs / re-typing the same query
  // doesn't re-hit the network.
  const resultsCacheRef = useRef<Map<string, SearchResults>>(new Map());
  const albumPreviewCacheRef = useRef<Map<string, PlaylistDetail>>(new Map());
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- Search effect: fires only on submittedQuery / category changes ----------
  useEffect(() => {
    if (submittedQuery.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setIsLoading(false);
      return;
    }

    const key = cacheKey(submittedQuery, activeCategory);
    const cached = resultsCacheRef.current.get(key);
    if (cached) {
      setResults(cached);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;
    const filter = activeCategory ? CATEGORY_PARAMS[activeCategory] : undefined;
    browseApi
      .search(submittedQuery, filter)
      .then((data) => {
        if (cancelled) return;
        resultsCacheRef.current.set(key, data);
        setResults(data);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [submittedQuery, activeCategory]);

  // ---------- Lazy fetch top-album preview tracks ----------
  useEffect(() => {
    if (activeCategory !== null) return;
    const album = results?.topAlbum;
    if (!album?.browseId) {
      setTopAlbumPreview(null);
      return;
    }
    const cached = albumPreviewCacheRef.current.get(album.browseId);
    if (cached) {
      setTopAlbumPreview(cached);
      return;
    }
    let cancelled = false;
    browseApi
      .getPlaylist(album.browseId)
      .then((detail) => {
        if (cancelled) return;
        albumPreviewCacheRef.current.set(album.browseId, detail);
        setTopAlbumPreview(detail);
      })
      .catch(() => {
        if (!cancelled) setTopAlbumPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [results, activeCategory]);

  // ---------- Pre-decode the top cover so it never appears half-painted ----------
  useEffect(() => {
    setTopCoverReady(false);
    const url = results?.topAlbum?.artworkUrl;
    if (!url || activeCategory !== null) return;
    let cancelled = false;
    const img = new Image();
    img.src = url;
    img
      .decode()
      .then(() => {
        if (!cancelled) setTopCoverReady(true);
      })
      .catch(() => {
        // decode() may reject for cross-origin images; reveal anyway so the
        // block doesn't stay permanently hidden.
        if (!cancelled) setTopCoverReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [results?.topAlbum?.artworkUrl, activeCategory]);

  // ---------- Debounced autocomplete suggestions ----------
  useEffect(() => {
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);

    if (query.length < MIN_SUGGEST_LENGTH || query === submittedQuery) {
      setSuggestions([]);
      return;
    }

    suggestDebounceRef.current = setTimeout(() => {
      browseApi
        .searchSuggestions(query)
        .then((items) => {
          setSuggestions(items.slice(0, MAX_SUGGESTIONS));
          setHighlightedIndex(-1);
        })
        .catch(() => {
          setSuggestions([]);
          setHighlightedIndex(-1);
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    };
  }, [query, submittedQuery]);

  const submitQuery = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    setQuery(trimmed);
    setSubmittedQuery(trimmed);
    setShowSuggestions(false);
    setSuggestions([]);
    setRecentSearches((prev) => {
      const next = pushRecentSearch(prev, trimmed);
      saveRecentSearches(next);
      return next;
    });
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    saveRecentSearches([]);
  };

  // When the app routes us here with a pending query (e.g. from Library →
  // Artist click), submit it once and clear the latch so we don't loop.
  useEffect(() => {
    if (!pendingQuery) return;
    submitQuery(pendingQuery);
    setActiveCategory(null);
    onPendingQueryConsumed?.();
  }, [pendingQuery, onPendingQueryConsumed]);

  const handleTabClick = (tab: CategoryTab) => {
    // Click the active tab again to deselect → unified view.
    setActiveCategory((cur) => (cur === tab ? null : tab));
  };

  const topAlbum: AlbumSummary | null = results?.topAlbum ?? null;
  const previewTracks =
    topAlbumPreview?.tracks?.slice(0, PREVIEW_TRACK_COUNT) ?? [];

  return (
    <section
      style={{
        padding: '0 var(--space-6)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <div style={{ height: 'var(--space-3)', flexShrink: 0 }} aria-hidden="true" />
      {/*
        Sticky wrapper keeps the search bar + category tabs pinned while the
        results scroll underneath (issue #58). Top padding matches the
        sidebar nav so the search bar lines up with the Search button
        (issue #59).
      */}
      <div
        style={{
          position: 'sticky',
          top: 'var(--space-3)',
          zIndex: 20,
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
        zIndex={20}
      ><div
        style={{
          width: '100%',
          padding:
            'calc(var(--title-bar-height) - var(--space-3)) var(--space-10) var(--space-3)',
          background: 'oklch(20% 0.005 270 / 0.30)',
          borderRadius: 'inherit',
        }}
      >
      <div
        style={{
          position: 'relative',
          maxWidth: '480px',
          marginBottom: 'var(--space-4)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 'var(--space-3)',
            top: '20px',
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
          placeholder="Search YouTube Music — press Enter"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
            setHighlightedIndex(-1);
          }}
          onKeyDown={(e) => {
            const visibleSuggestions =
              showSuggestions && suggestions.length > 0 ? suggestions : [];
            if (e.key === 'ArrowDown' && visibleSuggestions.length > 0) {
              e.preventDefault();
              setHighlightedIndex((idx) =>
                idx < visibleSuggestions.length - 1 ? idx + 1 : 0,
              );
            } else if (e.key === 'ArrowUp' && visibleSuggestions.length > 0) {
              e.preventDefault();
              setHighlightedIndex((idx) =>
                idx <= 0 ? visibleSuggestions.length - 1 : idx - 1,
              );
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (
                highlightedIndex >= 0 &&
                highlightedIndex < visibleSuggestions.length
              ) {
                submitQuery(visibleSuggestions[highlightedIndex]);
              } else {
                submitQuery(query);
              }
            } else if (e.key === 'Escape') {
              setShowSuggestions(false);
              setHighlightedIndex(-1);
            }
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-accent)';
            setShowSuggestions(true);
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'oklch(100% 0 0 / 0.14)';
            // Delay hiding so onMouseDown on a suggestion can fire first.
            window.setTimeout(() => setShowSuggestions(false), 150);
          }}
          style={{
            width: '100%',
            padding:
              'var(--space-3) var(--space-4) var(--space-3) var(--space-10)',
            // Translucent so the LiquidGlass plate behind it remains
            // visible — the previous opaque surface-2 fill broke the
            // glass effect with a flat dark pill in the middle.
            background: 'oklch(100% 0 0 / 0.06)',
            border: '1px solid oklch(100% 0 0 / 0.14)',
            borderRadius: 'var(--radius-full)',
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-primary)',
            outline: 'none',
            transition: `border-color var(--duration-fast) var(--ease-out)`,
          }}
        />

        {/* Suggestion dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <ul
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              listStyle: 'none',
              padding: 'var(--space-2) 0',
              margin: 0,
              background: 'var(--color-surface-2)',
              border: '1px solid oklch(100% 0 0 / 0.08)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 8px 24px oklch(0% 0 0 / 0.35)',
              zIndex: 50,
            }}
          >
            {suggestions.map((s, i) => {
              const isHighlighted = i === highlightedIndex;
              return (
                <li key={s}>
                  <button
                    // Use mouseDown so it fires before the input blurs.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      submitQuery(s);
                    }}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      width: '100%',
                      padding: 'var(--space-2) var(--space-4)',
                      background: isHighlighted
                        ? 'var(--color-surface-3)'
                        : 'none',
                      border: 'none',
                      color: 'var(--color-text-primary)',
                      fontSize: 'var(--text-sm)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ color: 'var(--color-text-tertiary)' }}>&#x2315;</span>
                    {s}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Category filter tabs */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
        }}
      >
        {CATEGORY_TABS.map((tab) => {
          const isActive = activeCategory === tab;
          return (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              style={{
                flexShrink: 0,
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 'var(--text-sm)',
                // Selection style unified with QueuePanel highlighted
                // row + Sidebar active item + Home mood pill: white
                // glass wash, accent-colored text, 600 weight.
                fontWeight: isActive ? 600 : 500,
                borderRadius: 'var(--radius-full)',
                border: isActive ? 'none' : '1px solid var(--color-border)',
                background: isActive ? 'oklch(100% 0 0 / 0.10)' : 'transparent',
                color: isActive
                  ? 'var(--color-accent)'
                  : 'var(--color-text-secondary)',
                cursor: 'pointer',
                transition: `background var(--duration-fast) var(--ease-out),
                             color var(--duration-fast) var(--ease-out)`,
                whiteSpace: 'nowrap',
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>
      </div>
      </LiquidGlass>
      </div>

      {/*
        Results region wrapped in a relative container so a reload can show
        a corner spinner while results stay interactive — stale-while-
        revalidate. The previous version disabled pointer events on the
        whole results panel while `isLoading=true`, which made every card
        in the search results unclickable for the entire duration of any
        YTM bridge stall (~30s during webview navigation).
      */}
      <div style={{ position: 'relative', minHeight: '200px' }}>
      <div
        style={{
          // Keep results fully interactive during reload — no blur, no
          // pointer-events block. The corner spinner below signals load.
        }}
      >

      {!results && !isLoading && (
        <div style={{ minHeight: '200px' }}>
          {recentSearches.length > 0 ? (
            <div style={{ paddingTop: 'var(--space-2)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: 'var(--text-sm)',
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  Recent searches
                </h2>
                <button
                  type="button"
                  onClick={clearRecentSearches}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-tertiary)',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                }}
              >
                {recentSearches.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => submitQuery(kw)}
                    style={{
                      padding: 'var(--space-2) var(--space-4)',
                      fontSize: 'var(--text-sm)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid oklch(100% 0 0 / 0.08)',
                      borderRadius: 'var(--radius-full)',
                      color: 'var(--color-text-primary)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {kw}
                  </button>
                ))}
              </div>
            </div>
          ) : (
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
        </div>
      )}

      {/* ---------- Unified default view (no tab selected) ---------- */}
      {results && activeCategory === null && (
        <>
          {topAlbum && topAlbumPreview && previewTracks.length > 0 && topCoverReady && (
            <ShelfRow title="Top result">
              {/*
                Flex with align-items: stretch — the cover (aspect-ratio: 1)
                derives its width from the row height, which equals the right
                column's natural content height. No JS measurement, no flash.
              */}
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-5)',
                  alignItems: 'stretch',
                }}
              >
                {/* Left: square cover, height = row height, width follows */}
                <TopAlbumCover
                  album={topAlbum}
                  onOpen={() => onOpenPlaylist?.(topAlbum.browseId)}
                  onPlay={() => {
                    playFirstFromPlaylist(topAlbum.browseId);
                    onOpenPlaylist?.(topAlbum.browseId);
                  }}
                />

                {/* Right: title block on top, top-3 songs underneath */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 'var(--text-xs)',
                        fontWeight: 500,
                        color: 'var(--color-text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        marginBottom: 'var(--space-1)',
                      }}
                    >
                      Album
                      {topAlbum.year ? ` • ${topAlbum.year}` : ''}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenPlaylist?.(topAlbum.browseId)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'block',
                        width: '100%',
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 'var(--text-xl)',
                          fontWeight: 700,
                          color: 'var(--color-text-primary)',
                          letterSpacing: '-0.02em',
                          lineHeight: 1.2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {topAlbum.title}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: 'var(--color-text-secondary)',
                          marginTop: 'var(--space-1)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {topAlbum.artist}
                      </div>
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {previewTracks.map((track, i) => (
                      <SongRow
                        key={track.videoId || `top-prev-${i}`}
                        track={track}
                        playlistId={topAlbum.browseId}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </ShelfRow>
          )}

          {results.songs.length > 0 && (
            <ShelfRow title="Songs">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  columnGap: 'var(--space-4)',
                  rowGap: 'var(--space-1)',
                }}
              >
                {results.songs.map((track, i) => (
                  <SongRow key={track.videoId || `song-${i}`} track={track} />
                ))}
              </div>
            </ShelfRow>
          )}

          {!topAlbum && results.songs.length === 0 && (
            <EmptyCategory label="results" />
          )}
        </>
      )}

      {/* ---------- Tab-specific views ---------- */}
      {results && activeCategory === 'Songs' && (
        <>
          {results.songs.length > 0 ? (
            <ShelfRow title="Songs">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  columnGap: 'var(--space-4)',
                  rowGap: 'var(--space-1)',
                }}
              >
                {results.songs.map((track, i) => (
                  <SongRow key={track.videoId || `song-${i}`} track={track} />
                ))}
              </div>
            </ShelfRow>
          ) : (
            <EmptyCategory label="songs" />
          )}
        </>
      )}

      {results && activeCategory === 'Albums' && (
        <>
          {results.albums.length > 0 ? (
            <ShelfRow title="Albums">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '20px',
                }}
              >
                {results.albums.map((album) => (
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
            </ShelfRow>
          ) : (
            <EmptyCategory label="albums" />
          )}
        </>
      )}

      {results && activeCategory === 'Playlists' && (
        <>
          {results.playlists.length > 0 ? (
            <ShelfRow title="Playlists">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '20px',
                }}
              >
                {results.playlists.map((playlist) => (
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
            </ShelfRow>
          ) : (
            <EmptyCategory label="playlists" />
          )}
        </>
      )}

      {results && activeCategory === 'Podcasts' && (
        <>
          {results.podcasts && results.podcasts.length > 0 ? (
            <ShelfRow title="Podcasts">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '20px',
                }}
              >
                {results.podcasts.map((show) => (
                  <AlbumCard
                    key={show.browseId}
                    artworkUrl={show.artworkUrl}
                    title={show.title}
                    subtitle={show.author}
                    onClick={() => onOpenPlaylist?.(show.browseId)}
                  />
                ))}
              </div>
            </ShelfRow>
          ) : (
            <EmptyCategory label="podcasts" />
          )}
        </>
      )}

      {results && activeCategory === 'Artists' && (
        <>
          {results.artists.length > 0 ? (
            <ShelfRow title="Artists">
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-5)',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  paddingBottom: 'var(--space-2)',
                }}
              >
                {results.artists.map((artist) => (
                  <button
                    key={artist.channelId}
                    onClick={() => {
                      // Open the dedicated ArtistPage instead of just
                      // re-running the search. `openArtist` flows
                      // through App's `searchForArtist` registry handler,
                      // which closes overlays and sets viewingArtist.
                      openArtist(artist.name);
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      flexShrink: 0,
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
                      <CachedImage
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
                  </button>
                ))}
              </div>
            </ShelfRow>
          ) : (
            <EmptyCategory label="artists" />
          )}
        </>
      )}

      </div>
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            background: results ? 'oklch(10% 0.005 270 / 0.35)' : 'transparent',
          }}
        >
          <div
            role="status"
            aria-label="Searching"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: '3px solid var(--color-surface-3)',
              borderTopColor: 'var(--color-accent)',
              animation: 'vibeytm-spin 0.9s linear infinite',
            }}
          />
        </div>
      )}
      </div>
      <div
        style={{
          height: 'calc(var(--player-bar-height) + var(--space-6))',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
    </section>
  );
};
