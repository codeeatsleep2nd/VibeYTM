import { type FC, useState } from 'react';
import type { AlbumSummary } from '../../../lib/types';
import { CachedImage } from '../../CachedImage';

interface TopAlbumCoverProps {
  album: AlbumSummary;
  onOpen: () => void;
  onPlay: () => void;
}

/**
 * Square album cover for the unified-search "Top result". Sized via flex
 * stretch + aspect-ratio so the height equals the row height (right column
 * content) and width follows naturally — no JS measurement, no flash.
 */
export const TopAlbumCover: FC<TopAlbumCoverProps> = ({ album, onOpen, onPlay }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      type="button"
      aria-label={`Open ${album.title}`}
      onClick={onOpen}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        aspectRatio: '1',
        height: 'auto',
        flex: '0 0 auto',
        // Stretched by the parent flex row; height matches row, width follows
        // from aspect-ratio: 1.
        alignSelf: 'stretch',
        padding: 0,
        border: 'none',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--color-surface-2)',
        cursor: 'pointer',
      }}
    >
      <CachedImage
        src={album.artworkUrl}
        alt={album.title}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />

      {/* Centered play button overlay */}
      <span
        aria-hidden
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: '52px',
          height: '52px',
          marginTop: '-26px',
          marginLeft: '-26px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-accent)',
          color: 'oklch(100% 0 0)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-lg)',
          boxShadow: '0 6px 16px oklch(0% 0 0 / 0.45)',
          cursor: 'pointer',
          opacity: isHovered ? 1 : 0,
          transform: isHovered ? 'scale(1)' : 'scale(0.85)',
          transition:
            'opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)',
        }}
      >
        {'▶'}
      </span>
    </button>
  );
};
