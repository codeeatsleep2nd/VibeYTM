import { type FC, useCallback, useEffect, useState } from 'react';
import type { Shelf, TrackInfo } from '../../lib/types';
import { browseApi, playFirstFromPlaylist } from '../../lib/ipc';
import { ShelfRow } from '../browse/ShelfRow';
import { AlbumCard } from '../browse/AlbumCard';
import { SongRow } from '../browse/SongRow';

interface HomePageProps {
  onOpenPlaylist?: (playlistId: string) => void;
  onAutoPlayPlaylist?: (playlistId: string) => void;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let cachedShelves: Shelf[] | null = null;
let cachedAt = 0;
let firstLoadDone = false;

const MOOD_TABS = [
  'All',
  'Energize',
  'Party',
  'Feel good',
  'Relax',
  'Workout',
  'Commute',
  'Romance',
  'Sad',
  'Focus',
  'Sleep',
] as const;

type MoodTab = (typeof MOOD_TABS)[number];

// Module-level so the mood selection survives tab-switch remounts — users
// expect returning to Home to land them back on the tab they were browsing,
// not snap-reset to "All".
let lastActiveMood: MoodTab = 'All';
let cachedMoodSongs: { mood: MoodTab; songs: TrackInfo[] } | null = null;

const SONGS_FILTER = 'EgWKAQIIAWoSEA4QCRAKEAUQBBADEBUQEBAR';

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export const HomePage: FC<HomePageProps> = ({ onOpenPlaylist }) => {
  const [shelves, setShelves] = useState<Shelf[]>(cachedShelves ?? []);
  const [isLoading, setIsLoading] = useState(!cachedShelves);
  const [activeMood, setActiveMood] = useState<MoodTab>(lastActiveMood);
  const [moodSongs, setMoodSongs] = useState<TrackInfo[]>(
    cachedMoodSongs && cachedMoodSongs.mood === lastActiveMood
      ? cachedMoodSongs.songs
      : [],
  );
  const [isMoodLoading, setIsMoodLoading] = useState(false);

  const selectMood = useCallback((mood: MoodTab) => {
    lastActiveMood = mood;
    setActiveMood(mood);
  }, []);

  const fetchHome = useCallback((force = false) => {
    // Always force on the very first load of the app session
    const shouldForce = force || !firstLoadDone;
    if (!shouldForce && cachedShelves && Date.now() - cachedAt < CACHE_TTL_MS) {
      setShelves(cachedShelves);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    browseApi
      .getHome()
      .then((data) => {
        cachedShelves = data;
        cachedAt = Date.now();
        firstLoadDone = true;
        setShelves(data);
        setIsLoading(false);
      })
      .catch((e) => {
        console.error('[HomePage] getHome failed:', e);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchHome();
  }, [fetchHome]);

  // Fetch mood songs when a mood tab other than "All" is selected
  useEffect(() => {
    if (activeMood === 'All') {
      setMoodSongs([]);
      return;
    }

    // If we still have the same mood's songs cached from a previous visit,
    // render them immediately and skip the fetch.
    if (cachedMoodSongs && cachedMoodSongs.mood === activeMood) {
      setMoodSongs(cachedMoodSongs.songs);
      setIsMoodLoading(false);
      return;
    }

    let cancelled = false;
    setIsMoodLoading(true);

    browseApi
      .search(activeMood, SONGS_FILTER)
      .then((results) => {
        if (!cancelled) {
          cachedMoodSongs = { mood: activeMood, songs: results.songs };
          setMoodSongs(results.songs);
          setIsMoodLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMoodSongs([]);
          setIsMoodLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeMood]);

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
          paddingTop: 'var(--space-8)',
          paddingBottom: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
        }}
      >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
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
          {getGreeting()}
        </h1>
        <button
          onClick={() => fetchHome(true)}
          disabled={isLoading}
          style={{
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-1) var(--space-3)',
            color: 'var(--color-text-tertiary)',
            cursor: isLoading ? 'wait' : 'pointer',
            fontSize: 'var(--text-sm)',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Mood / genre tabs */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {MOOD_TABS.map((tab) => {
          const isActive = tab === activeMood;
          return (
            <button
              key={tab}
              onClick={() => selectMood(tab)}
              style={{
                flexShrink: 0,
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                borderRadius: 'var(--radius-full)',
                border: isActive ? 'none' : '1px solid var(--color-border)',
                background: isActive ? 'var(--color-accent)' : 'transparent',
                color: isActive
                  ? 'oklch(100% 0 0)'
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

      {activeMood !== 'All' && (
        <>
          {isMoodLoading && (
            <p
              style={{
                fontSize: 'var(--text-base)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              Loading {activeMood} songs...
            </p>
          )}
          {!isMoodLoading && moodSongs.length > 0 && (
            <ShelfRow title={`${activeMood} Songs`}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  columnGap: 'var(--space-4)',
                  rowGap: 'var(--space-1)',
                }}
              >
                {moodSongs.map((track, i) => (
                  <SongRow key={track.videoId || `mood-${i}`} track={track} />
                ))}
              </div>
            </ShelfRow>
          )}
          {!isMoodLoading && moodSongs.length === 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '120px',
              }}
            >
              <p
                style={{
                  fontSize: 'var(--text-base)',
                  color: 'var(--color-text-tertiary)',
                  textAlign: 'center',
                }}
              >
                No songs found for "{activeMood}"
              </p>
            </div>
          )}
        </>
      )}

      {activeMood === 'All' &&
        shelves.map((shelf) => (
          <ShelfRow key={shelf.title} title={shelf.title}>
            {renderShelfContent(shelf, onOpenPlaylist)}
          </ShelfRow>
        ))}
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
          {items.data.map((album, i) => (
            <AlbumCard
              key={`${album.browseId || 'album'}-${i}`}
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
          {items.data.map((artist, i) => (
            <div
              key={`${artist.channelId || 'artist'}-${i}`}
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
          {items.data.map((playlist, i) => (
            <AlbumCard
              key={`${playlist.playlistId || 'pl'}-${i}`}
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
