import { type FC, useEffect, useState } from 'react';
import type { TrackInfo } from '../../lib/types';
import { browseApi } from '../../lib/ipc';
import { rememberTrackArtworks } from '../../lib/trackArtworkRegistry';
import { debug } from '../../lib/debug';
import { SongRow } from '../browse/SongRow';
import { SkeletonRow } from '../Skeleton';

// Issue #83 + #93 — Recently Played page. Originally backed by a
// locally-tracked log; the follow-up (#93) moved the data source to
// YouTube Music's own `FEmusic_history` endpoint, which matches what
// the user sees on YTM's web History page. Layout mirrors LibraryPage:
// sticky title plate + 3-column SongRow grid.

const HISTORY_PAGE_SECTION_LABEL = 'RECENTLY PLAYED';

export const HistoryPage: FC = () => {
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
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
        rememberTrackArtworks(data);
        setTracks(data);
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

  return (
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
          zIndex: 20,
          padding:
            'calc(var(--title-bar-height) - var(--space-3)) var(--space-4) var(--space-3)',
          marginBottom: 'var(--space-4)',
          background: 'oklch(20% 0.005 270 / 0.30)',
          backdropFilter: 'blur(var(--glass-blur))',
          WebkitBackdropFilter: 'blur(var(--glass-blur))',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--glass-rim-mid)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {HISTORY_PAGE_SECTION_LABEL}
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          History
        </h1>
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

      {!isLoading && !error && tracks.length === 0 && (
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

      {!isLoading && !error && tracks.length > 0 && (
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
              key={(track.videoId || 'history') + ':' + i}
              track={track}
            />
          ))}
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
};
