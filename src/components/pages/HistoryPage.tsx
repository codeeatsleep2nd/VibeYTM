import { type FC, useEffect, useMemo, useState } from 'react';
import { LiquidGlass } from '@liquidglass/react';
import type { HistorySection, TrackInfo } from '../../lib/types';
import { browseApi } from '../../lib/ipc';
import { rememberTrackArtworks } from '../../lib/trackArtworkRegistry';
import { debug } from '../../lib/debug';
import { SongRow } from '../browse/SongRow';
import { SkeletonRow } from '../Skeleton';

// Issue #93 follow-up — group the history by Today / Yesterday / This
// week / Earlier (mirrors how Apple Music + YTM Web present the same
// list). Backend returns YTM's date-grouped sections preserving the
// original header labels; the FE buckets them. Title plate uses the
// same LiquidGlass capsule as HomePage / LibraryPage so every page
// reads the same in the chrome.

type BucketKey = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

const BUCKET_ORDER: readonly BucketKey[] = [
  'Today',
  'Yesterday',
  'This week',
  'Earlier',
] as const;

/**
 * Bucket each YTM section header into one of the four display groups.
 *   - "Today" → Today
 *   - "Yesterday" → Yesterday
 *   - any other label whose date parses within the last 7 days
 *     (excluding today/yesterday) → This week
 *   - everything else → Earlier
 *
 * `now` is injected for testability — defaults to wall-clock.
 */
export function bucketHistorySections(
  sections: HistorySection[],
  now: Date = new Date(),
): Record<BucketKey, TrackInfo[]> {
  const buckets: Record<BucketKey, TrackInfo[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    Earlier: [],
  };

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  // 6 days back from start-of-today: covers the full current rolling
  // week excluding today + yesterday (those have their own buckets).
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  for (const section of sections) {
    const norm = section.label.trim().toLowerCase();
    if (norm === 'today') {
      buckets.Today.push(...section.tracks);
      continue;
    }
    if (norm === 'yesterday') {
      buckets.Yesterday.push(...section.tracks);
      continue;
    }

    // YTM uses things like "Last week" or specific dates ("October 29").
    // Try to parse the label as a date; fall through to Earlier when we
    // can't make sense of it.
    const parsed = new Date(section.label);
    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed >= sevenDaysAgo &&
      parsed < startOfToday
    ) {
      buckets['This week'].push(...section.tracks);
      continue;
    }

    buckets.Earlier.push(...section.tracks);
  }

  return buckets;
}

export const HistoryPage: FC = () => {
  const [sections, setSections] = useState<HistorySection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    browseApi
      .getHistory()
      .then((data) => {
        if (cancelled) return;
        // Flatten just for the artwork registry — every track's cover
        // helps QueuePanel + NowPlaying resolve faster on subsequent
        // plays. The grouping itself stays intact in `sections`.
        rememberTrackArtworks(data.flatMap((s) => s.tracks));
        setSections(data);
        setIsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError('Could not load history');
        setIsLoading(false);
        debug.error('HistoryPage', 'getHistory failed', e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buckets = useMemo(() => bucketHistorySections(sections), [sections]);
  const totalTracks = sections.reduce((n, s) => n + s.tracks.length, 0);

  return (
    <section
      style={{
        padding: '0 var(--space-6)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <div style={{ height: 'var(--space-3)', flexShrink: 0 }} aria-hidden="true" />

      {/* Canonical sticky title plate — same LiquidGlass capsule
          recipe HomePage and LibraryPage use, so the chrome reads
          consistent across every page. */}
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
        >
          <div
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
                margin: 0,
                fontSize: 'var(--text-2xl)',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--color-text-primary)',
              }}
            >
              History
            </h1>
          </div>
        </LiquidGlass>
      </div>

      {isLoading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            columnGap: 'var(--space-4)',
            rowGap: 'var(--space-1)',
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <p
          style={{
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-base)',
          }}
        >
          {error}
        </p>
      )}

      {!isLoading && !error && totalTracks === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '40vh',
          }}
        >
          <p
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            No recently played tracks yet — start a song and it will appear here.
          </p>
        </div>
      )}

      {!isLoading && !error && totalTracks > 0 && (
        <>
          {BUCKET_ORDER.map((key) => {
            const tracks = buckets[key];
            if (tracks.length === 0) return null;
            return (
              <div key={key} style={{ marginBottom: 'var(--space-6)' }}>
                <h2
                  style={{
                    fontSize: 'var(--text-lg)',
                    fontWeight: 700,
                    letterSpacing: '-0.01em',
                    color: 'var(--color-text-primary)',
                    margin: '0 0 var(--space-3) 0',
                  }}
                >
                  {key}
                </h2>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    columnGap: 'var(--space-4)',
                    rowGap: 'var(--space-1)',
                  }}
                >
                  {tracks.map((track, i) => (
                    <SongRow
                      key={`${key}:${track.videoId || 'history'}:${i}`}
                      track={track}
                    />
                  ))}
                </div>
              </div>
            );
          })}
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
};
