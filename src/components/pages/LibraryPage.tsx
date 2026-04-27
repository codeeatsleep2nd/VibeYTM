import { type FC, useEffect, useState } from 'react';
import type {
  PlaylistSummary,
  TrackInfo,
  AlbumSummary,
  ArtistSummary,
  PodcastSummary,
  PodcastLastEpisode,
} from '../../lib/types';
import { browseApi, playFirstFromPlaylist } from '../../lib/ipc';
import { readCache, writeCache } from '../../lib/persistentCache';
import { rememberTrackArtworks } from '../../lib/trackArtworkRegistry';
import { AlbumCard } from '../browse/AlbumCard';
import { SongRow } from '../browse/SongRow';
import { CachedImage } from '../CachedImage';
import { LoadingSpinner, ReloadOverlay } from '../LoadingOverlay';
import { LiquidGlass } from '@liquidglass/react';

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
  podcasts: 'library:podcasts',
} as const;

export type LibraryTab =
  | 'playlists'
  | 'songs'
  | 'albums'
  | 'artists'
  | 'podcasts';

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
  podcasts: 'Podcasts',
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
  const [podcasts, setPodcasts] = useState<PodcastSummary[]>(
    () => readCache<PodcastSummary[]>(PERSIST_KEYS.podcasts) ?? [],
  );
  // Per-browseId recency map populated AFTER the podcast list lands.
  // Each entry comes from the dedicated `get_podcast_last_episode`
  // IPC, which fetches the show and returns just the first episode's
  // `publishedTimeText` + a server-parsed secsAgo. Persisted to
  // localStorage with a 1-hour TTL so reopening the Podcasts tab
  // doesn't re-fan-out the per-show fetches.
  const [podcastRecency, setPodcastRecency] = useState<Record<string, PodcastLastEpisode>>(
    () =>
      readCache<Record<string, PodcastLastEpisode>>(
        'library:podcasts:recency',
        60 * 60 * 1000, // 1h TTL — newer than that and we trust the cached map
      ) ?? {},
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
              rememberTrackArtworks(data);
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
          case 'podcasts': {
            const data = await browseApi.getLibraryPodcasts();
            if (!cancelled) {
              setPodcasts(data);
              writeCache(PERSIST_KEYS.podcasts, data);
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

  // After the podcast list lands, fan out per-show "last updated"
  // probes in parallel with a small concurrency cap. Skip shows
  // whose recency we already have (cache hit). Cancellation flag
  // makes the loop a no-op once the user navigates off the tab.
  useEffect(() => {
    if (activeTab !== 'podcasts' || podcasts.length === 0) return;
    const missing = podcasts.filter((p) => !podcastRecency[p.browseId]);
    if (missing.length === 0) return;

    let cancelled = false;
    const CONCURRENCY = 4;
    let cursor = 0;
    const next: Record<string, PodcastLastEpisode> = {};

    const worker = async () => {
      while (!cancelled) {
        const i = cursor;
        cursor += 1;
        if (i >= missing.length) return;
        const p = missing[i];
        try {
          const result = await browseApi.getPodcastLastEpisode(p.browseId);
          if (cancelled || !result) continue;
          next[p.browseId] = result;
        } catch {
          // Best-effort — a single show failure shouldn't poison the
          // batch. The card just stays without a recency line.
        }
      }
    };

    Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => worker()),
    ).then(() => {
      if (cancelled) return;
      if (Object.keys(next).length === 0) return;
      setPodcastRecency((prev) => {
        const merged = { ...prev, ...next };
        writeCache('library:podcasts:recency', merged);
        return merged;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, podcasts, podcastRecency]);

  // Sort podcasts most-recent-first using the recency map. Shows
  // without a parsed secsAgo (cache miss or unparseable date) sink to
  // the bottom in their original API order.
  const sortedPodcasts = (() => {
    if (Object.keys(podcastRecency).length === 0) return podcasts;
    const indexOf = new Map(podcasts.map((p, i) => [p.browseId, i] as const));
    return [...podcasts].sort((a, b) => {
      const aSecs = podcastRecency[a.browseId]?.secsAgo;
      const bSecs = podcastRecency[b.browseId]?.secsAgo;
      if (aSecs !== undefined && bSecs !== undefined) return aSecs - bSecs;
      if (aSecs !== undefined) return -1;
      if (bSecs !== undefined) return 1;
      return (indexOf.get(a.browseId) ?? 0) - (indexOf.get(b.browseId) ?? 0);
    });
  })();

  const currentTabHasData =
    (activeTab === 'playlists' && playlists.length > 0) ||
    (activeTab === 'songs' && songs.length > 0) ||
    (activeTab === 'albums' && albums.length > 0) ||
    (activeTab === 'artists' && artists.length > 0) ||
    (activeTab === 'podcasts' && podcasts.length > 0);

  if (isLoading && !currentTabHasData) {
    return <LoadingSpinner />;
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
        </div></LiquidGlass>
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

      {activeTab === 'podcasts' && (
        <>
          {podcasts.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '20px',
              }}
            >
              {sortedPodcasts.map((p) => {
                const recency = podcastRecency[p.browseId];
                return (
                  <AlbumCard
                    key={p.browseId}
                    artworkUrl={p.artworkUrl}
                    title={p.title}
                    // Subtitle: author + (once the per-show recency
                    // probe lands) the latest episode's age, joined
                    // by a middle-dot. Empty until the probe returns.
                    subtitle={
                      recency
                        ? `${p.author} · ${recency.display}`
                        : p.author
                    }
                    onClick={() => onOpenPlaylist?.(p.browseId)}
                    // Click on the play icon opens the show; the first
                    // episode plays automatically once it's loaded
                    // through the existing autoPlayPlaylist branch.
                    onPlay={() => {
                      playFirstFromPlaylist(p.browseId);
                      onOpenPlaylist?.(p.browseId);
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <EmptyState label="podcasts" />
          )}
        </>
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
