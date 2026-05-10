import { type FC, useCallback, useEffect, useState } from 'react';
import type { Shelf, TrackInfo } from '../../lib/types';
import { browseApi, playFirstFromPlaylist } from '../../lib/ipc';
import { debug } from '../../lib/debug';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { readCache, writeCache, clearCache } from '../../lib/persistentCache';
import { ShelfRow } from '../browse/ShelfRow';
import { AlbumCard } from '../browse/AlbumCard';
import { SongRow } from '../browse/SongRow';
import { CachedImage } from '../CachedImage';
import { LoadingSpinner, ReloadOverlay } from '../LoadingOverlay';
import { LiquidGlass } from '@liquidglass/react';

interface HomePageProps {
  onOpenPlaylist?: (playlistId: string) => void;
  onAutoPlayPlaylist?: (playlistId: string) => void;
  /**
   * Fires once the home page has finished loading shelves (or surfaced an
   * empty state). Used by App.tsx to dismiss the welcome splash at the
   * earliest moment there's something real to look at (issue #56).
   */
  onReady?: () => void;
}

// Soft TTL for the in-memory mirror — after this we still serve from
// memory but trigger a background refresh so the user gets fresh data
// while interacting with last-known-good. The persistentCache layer
// holds onto the same payload for 7 days across app restarts so the
// shelves render instantly on cold start (no blank-grid window while
// the network call is in flight).
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PERSIST_KEY = 'home:shelves';

let cachedShelves: Shelf[] | null = readCache<Shelf[]>(PERSIST_KEY);
let cachedAt = cachedShelves ? Date.now() - CACHE_TTL_MS : 0;
let firstLoadDone = false;

// Called by App.tsx on every login transition so an unmounted HomePage
// re-reads from a clean slate on its next mount instead of seeding from
// the previous account's shelves.
export function resetHomePageModuleCache(): void {
  cachedShelves = null;
  cachedAt = 0;
  firstLoadDone = false;
  cachedMoodSongs = null;
}

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

// Personal shelves users want pinned to the top of Home, in this exact
// display order. Each slot accepts multiple title variants for forward
// compatibility in case YTM renames a shelf. Match is case-insensitive
// and trim-tolerant.
//
// Verified against the live running app via REORDER-DIAG on 2026-05-02:
// YTM's actual shelf titles for slots 0-2 in the user's home are
// "Listen again", "Your daily discover" (note: no trailing 'y' — YTM's
// UI truncates), and "Albums for you".
const PRIORITY_TITLE_ALIASES: ReadonlyArray<ReadonlyArray<string>> = [
  ['Listen again'],
  [
    'Your daily discover',
    'Your daily discovery',
    'Daily discovery',
    'Discovery',
  ],
  ['Albums for you'],
];

export function reorderShelves(shelves: Shelf[]): Shelf[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const priorityIndex = new Map<string, number>();
  PRIORITY_TITLE_ALIASES.forEach((aliases, slot) => {
    for (const alias of aliases) priorityIndex.set(norm(alias), slot);
  });

  const pinned: Shelf[] = [];
  const rest: Shelf[] = [];
  const filledSlots = new Set<number>();

  for (const shelf of shelves) {
    const slot = priorityIndex.get(norm(shelf.title));
    if (slot !== undefined && !filledSlots.has(slot)) {
      pinned[slot] = shelf;
      filledSlots.add(slot);
    } else {
      rest.push(shelf);
    }
  }

  // pinned may be sparse if some priority shelves are absent — filter holes
  return [...pinned.filter(Boolean), ...rest];
}

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export const HomePage: FC<HomePageProps> = ({ onOpenPlaylist, onReady }) => {
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
      // Warm cache path still needs to dismiss the splash (issue #56).
      onReady?.();
      return;
    }
    setIsLoading(true);
    browseApi
      .getHome()
      .then((data) => {
        cachedShelves = data;
        cachedAt = Date.now();
        firstLoadDone = true;
        writeCache(PERSIST_KEY, data);
        setShelves(data);
        setIsLoading(false);
        onReady?.();
      })
      .catch((e) => {
        debug.error('HomePage', 'getHome failed', e);
        setIsLoading(false);
        // Still dismiss the welcome splash — users shouldn't get stuck on
        // it if the first fetch fails.
        onReady?.();
      });
    // onReady intentionally omitted — we only want to refetch on explicit
    // triggers, not when the parent remounts the callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchHome();
  }, [fetchHome]);

  // Any login transition (sign-in OR sign-out) means the cached shelves
  // belong to a different account than the one now active. Drop them so
  // the next render pulls fresh content instead of leaking the previous
  // user's personalized shelves through this account's home feed
  // (issue #50, extended for sign-in transitions too).
  useTauriEvent<boolean>('player:login-changed', () => {
    cachedShelves = null;
    cachedAt = 0;
    firstLoadDone = false;
    cachedMoodSongs = null;
    clearCache(PERSIST_KEY);
    setShelves([]);
    setMoodSongs([]);
    fetchHome(true);
  });

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

  if (isLoading && shelves.length === 0) {
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
      {/* 12 px seam spacer — pushes the plate down by `--space-3` at
          scroll=0 so the seam is visible above the plate. As the user
          scrolls, this spacer scrolls up and out, and content rows
          that have scrolled past the plate's sticky position are
          briefly visible in the seam before being clipped at
          section's top edge. */}
      <div style={{ height: 'var(--space-3)', flexShrink: 0 }} aria-hidden="true" />
      <div
        // Sticky positioning wrapper. The actual glass surface is the
        // `<LiquidGlass>` child — it can't carry sticky positioning
        // itself (the component fills its parent and centers its
        // children via flex), so we wrap it.
        style={{
          position: 'sticky',
          // Sticks 12 px below section's viewport top — the seam
          // window. Scrolled content is visible passing through that
          // 12 px gap as it scrolls past the plate's sticky position
          // and is clipped at section.top.
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
          // Top padding includes `--title-bar-height` so the title
          // text clears the drag region (the plate now touches y=0
          // of the window — see AppShell main's removed paddingTop).
          // Title text lands at `y = title-bar-height` (just under the
          // drag region). main has `paddingTop: var(--space-3)` (the
          // visible seam), so the plate's own paddingTop only needs
          // to cover the remaining `title-bar-height - space-3`.
          padding:
            'calc(var(--title-bar-height) - var(--space-3)) var(--space-10) var(--space-3)',
          // Same semi-transparent dark wash as the player chrome — the
          // capsule reads as a discrete plate even when WebKit drops
          // the LiquidGlass SVG displacement filter.
          background: 'oklch(20% 0.005 270 / 0.30)',
          borderRadius: 'inherit',
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
          overflowY: 'hidden',
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
                // Selection style unified with QueuePanel highlighted
                // row + Sidebar active item: white-wash glass tint,
                // accent-colored text, 600 weight. Replaces the prior
                // solid-accent pill so every "selected" surface in the
                // UI reads the same visual weight.
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
        reorderShelves(shelves).map((shelf) => (
          <ShelfRow key={shelf.title} title={shelf.title}>
            {renderShelfContent(shelf, onOpenPlaylist)}
          </ShelfRow>
        ))}
      {/* Spacer reserves scroll room above the floating player chrome.
          A real DOM child (not padding-bottom) — WebKit drops
          padding-bottom from `scrollHeight` on overflow containers. */}
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
            overflowY: 'hidden',
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
          {items.data.map((playlist, i) => (
            <AlbumCard
              key={`${playlist.playlistId || 'pl'}-${i}`}
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
