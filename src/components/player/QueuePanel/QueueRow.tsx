import { type FC } from 'react';
import type { TrackInfo } from '../../../lib/types';
import { QueueArtwork } from './QueueArtwork';
import { ContextMenuTarget } from '../../contextMenu/ContextMenu';
import { buildTrackContextMenu } from '../../contextMenu/trackActions';
import { lookupTrackMeta } from '../../../lib/trackMetaRegistry';

/**
 * Three vertical bars that bounce in sequence — the universal "audio is
 * playing" affordance. Rendered as an overlay on top of the artwork
 * thumbnail of the now-playing row, with a translucent dark scrim so
 * the bars stay legible against any cover art.
 */
const PlayingBarsOverlay: FC = () => (
  <div
    aria-hidden
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: '2px',
      paddingBottom: '6px',
      background: 'oklch(0% 0 0 / 0.45)',
      pointerEvents: 'none',
    }}
  >
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        style={{
          width: '3px',
          height: '60%',
          background: 'var(--color-accent)',
          borderRadius: '1px',
          transformOrigin: 'bottom',
          animation: `vibeytm-bar 900ms ease-in-out ${i * 150}ms infinite`,
        }}
      />
    ))}
  </div>
);

interface QueueRowProps {
  track: TrackInfo;
  highlighted?: boolean;
  /** When true, render the animated playing-bars indicator + accent style. */
  nowPlaying?: boolean;
  /** When true, render at lower opacity (history rows). */
  dimmed?: boolean;
  onPlay?: () => void;
  /**
   * Optional live PlayerState track. Forwarded to `QueueArtwork` for
   * the now-playing row so the queue thumbnail matches the player bar's
   * canonical album-art URL even when the queue's own metadata came
   * from a DOM scrape with a signed thumbnail.
   */
  liveTrack?: TrackInfo | null;
}

export const QueueRow: FC<QueueRowProps> = ({
  track,
  highlighted = false,
  nowPlaying = false,
  dimmed = false,
  onPlay,
  liveTrack,
}) => {
  const interactive = Boolean(onPlay) && !highlighted;

  // Bridge JS scrapes podcast / show episode rows via selectors
  // (`.song-title`, `.byline`) that don't match the multi-row episode
  // shape, so episode queue rows arrive with empty title + artist. Fall
  // back to the per-track metadata registry that
  // `PlaylistDetailPage` populates from the Rust parser, which has
  // proper episode title + show-name artist.
  const meta = (!track.title || !track.artist)
    ? lookupTrackMeta(track.videoId)
    : undefined;
  const displayTitle = track.title || meta?.title || 'Unknown title';
  const displayArtist = track.artist || meta?.artist || '';

  const content = (
    <>
      <div
        style={{
          width: '40px',
          height: '40px',
          flexShrink: 0,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface-3)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <QueueArtwork track={track} liveTrack={liveTrack} />
        {nowPlaying && <PlayingBarsOverlay />}
      </div>
      <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: highlighted ? 600 : 500,
            color: highlighted
              ? 'var(--color-accent)'
              : 'var(--color-text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {displayTitle}
        </div>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {displayArtist}
        </div>
      </div>
    </>
  );

  const baseStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    width: '100%',
    // Translucent highlight so the LiquidGlass plate behind the queue
    // remains visible — matches the rest of the UI's glass treatment.
    // (The previous opaque `var(--color-surface-2)` painted a flat
    // dark stripe over the glass.)
    background: highlighted
      ? 'oklch(100% 0 0 / 0.10)'
      : 'transparent',
    border: 'none',
    color: 'inherit',
    textAlign: 'left' as const,
    cursor: interactive ? 'pointer' : 'default',
    opacity: dimmed ? 0.55 : 1,
    transition: `background var(--duration-fast) var(--ease-out),
                 opacity var(--duration-fast) var(--ease-out)`,
  };

  // Right-click menu: Play now / Add to queue / Copy link. Built lazily
  // via `buildTrackContextMenu` so the same set of actions is shared
  // with every other track surface (song rows, top results, etc.) once
  // they wire up the same primitive. Queue rows don't expose Remove yet
  // because the YTM `remove_from_queue` IPC takes an in-memory index
  // that doesn't map cleanly to the rendered row index when liveQueue
  // and frozenQueue diverge — addressed in a follow-up.
  const buildSections = () =>
    buildTrackContextMenu({ track });

  if (!interactive) {
    return (
      <ContextMenuTarget buildSections={buildSections}>
        <div style={baseStyle}>{content}</div>
      </ContextMenuTarget>
    );
  }

  return (
    <ContextMenuTarget buildSections={buildSections}>
      <button
        type="button"
        onClick={onPlay}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--color-surface-2)';
          e.currentTarget.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.opacity = dimmed ? '0.55' : '1';
        }}
        style={baseStyle}
      >
        {content}
      </button>
    </ContextMenuTarget>
  );
};
