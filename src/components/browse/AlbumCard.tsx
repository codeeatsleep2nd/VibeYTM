import { type FC, useState } from 'react';
import { CachedImage } from '../CachedImage';

interface AlbumCardProps {
  artworkUrl: string;
  title: string;
  subtitle: string;
  onClick?: () => void;
  onPlay?: () => void;
  /** When true, render only the cover (no title/subtitle caption). */
  hideCaption?: boolean;
}

export const AlbumCard: FC<AlbumCardProps> = ({
  artworkUrl,
  title,
  subtitle,
  onClick,
  onPlay,
  hideCaption = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        textAlign: 'left',
        transform: isHovered ? 'scale(1.02)' : 'scale(1)',
        transition: `transform var(--duration-normal) var(--ease-out)`,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          background: 'var(--color-surface-2)',
        }}
      >
        <CachedImage
          src={artworkUrl}
          alt={`${title} artwork`}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />

        {/* Darkening overlay — decorative only, pointer events off */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'oklch(0% 0 0 / 0.35)',
            opacity: isHovered ? 1 : 0,
            transition: `opacity var(--duration-normal) var(--ease-out)`,
            pointerEvents: 'none',
          }}
        />

        {/* Play button — ONLY this element catches clicks for onPlay */}
        {onPlay && (
          <button
            type="button"
            aria-label="Play"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: isHovered
                ? 'translate(-50%, -50%) scale(1)'
                : 'translate(-50%, -50%) scale(0.8)',
              width: '44px',
              height: '44px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-lg)',
              color: 'var(--color-text-primary)',
              opacity: isHovered ? 1 : 0,
              cursor: 'pointer',
              transition: `transform var(--duration-normal) var(--ease-out),
                           opacity var(--duration-normal) var(--ease-out)`,
            }}
          >
            {'\u25B6'}
          </button>
        )}
      </div>

      {!hideCaption && (
        <div style={{ padding: '0 var(--space-1)' }}>
          <div
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: 'var(--color-text-primary)',
            }}
          >
            {title}
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
            {subtitle}
          </div>
        </div>
      )}
    </button>
  );
};
