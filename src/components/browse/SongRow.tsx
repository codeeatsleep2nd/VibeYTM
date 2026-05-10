import { type FC, useState } from 'react';
import type { TrackInfo } from '../../lib/types';
import { playerApi } from '../../lib/ipc';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';
import { ContextMenuTarget } from '../contextMenu/ContextMenu';
import { buildTrackContextMenu } from '../contextMenu/trackActions';

interface SongRowProps {
  track: TrackInfo;
  index?: number;
  onClick?: () => void;
  playlistId?: string;
}

const formatDuration = (secs: number): string => {
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const SongRow: FC<SongRowProps> = ({ track, index, onClick, playlistId }) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (track.videoId) {
      playerApi.playTrack(track.videoId, playlistId).catch(() => {});
    }
  };

  return (
    <ContextMenuTarget buildSections={() => buildTrackContextMenu({ track })}>
    <button
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: '100%',
        // No paddingLeft — list rows align their content with the
        // parent container's content edge (matching the leftmost
        // visual element of the page, e.g., a hero cover image).
        // paddingRight stays so the duration column doesn't crowd
        // the row's right edge.
        padding: 'var(--space-2) var(--space-3) var(--space-2) 0',
        // Glass-tile hover (rim + thickness + lift) replaces the flat
        // `--color-surface-2` fill so the hovered row reads as a
        // discrete glass plate floating above the list. Tokens.css
        // owns the recipe — same as sidebar nav, mood pills, focus
        // chips, search category tabs.
        background: isHovered ? 'var(--glass-tile-bg-active)' : 'transparent',
        boxShadow: isHovered ? 'var(--glass-tile-shadow)' : undefined,
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        transition:
          'background var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
      }}
    >
      {index !== undefined && (
        <span
          style={{
            width: '24px',
            textAlign: 'right',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-tertiary)',
            flexShrink: 0,
          }}
        >
          {index}
        </span>
      )}

      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          background: 'var(--color-surface-3)',
          flexShrink: 0,
        }}
      >
        {track.artworkUrl && (
          <CachedImage
            src={track.artworkUrl}
            alt={`${track.title} artwork`}
            loading="lazy"
            width={40}
            height={40}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <MarqueeText
          text={track.title}
          hovered={isHovered}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
          }}
        />
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {track.artist}
        </div>
      </div>

      {track.durationSecs > 0 && (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            flexShrink: 0,
          }}
        >
          {formatDuration(track.durationSecs)}
        </span>
      )}
    </button>
    </ContextMenuTarget>
  );
};
