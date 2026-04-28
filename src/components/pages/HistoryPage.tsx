import { type FC, useState } from 'react';
import { usePlaybackHistory } from '../../hooks/usePlaybackHistory';
import { clearHistory } from '../../lib/playbackHistory';
import { SongRow } from '../browse/SongRow';

// Issue #83 — Recently Played view. Mirrors the visual structure of
// LibraryPage (sticky title plate + scrolling list) so the user sees
// History as a peer of the existing library tabs.

const HISTORY_PAGE_SECTION_LABEL = 'RECENTLY PLAYED';

export const HistoryPage: FC = () => {
  const entries = usePlaybackHistory();
  // After Clear, suppress every entry whose `playedAt` predates the
  // wall-clock instant of the click. Storing the cut-off as a timestamp
  // (instead of a `showAll` boolean) means a NEW track played after
  // Clear naturally surfaces — its `playedAt` will be larger than the
  // cut-off, so the filter passes it through. A boolean would have
  // permanently hidden the page until app remount (issue caught in
  // code review of ba71fb0).
  const [clearedAt, setClearedAt] = useState<number | null>(null);

  const handleClear = () => {
    clearHistory();
    setClearedAt(Date.now());
  };

  const visible =
    clearedAt === null
      ? entries
      : entries.filter((e) => e.playedAt > clearedAt);

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
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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

        {visible.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-full)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {visible.length === 0 ? (
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
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            columnGap: 'var(--space-4)',
            rowGap: 'var(--space-1)',
          }}
        >
          {visible.map((entry) => (
            <SongRow
              key={entry.track.videoId + ':' + entry.playedAt}
              track={entry.track}
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
