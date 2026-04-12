import { type FC, useState } from 'react';
import type { TrackInfo } from '../../lib/types';
import { playerApi } from '../../lib/ipc';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';

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
    <button
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: '100%',
        padding: 'var(--space-2) var(--space-3)',
        background: isHovered ? 'var(--color-surface-2)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: `background var(--duration-fast) var(--ease-out)`,
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
  );
};
