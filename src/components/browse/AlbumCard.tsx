import { type FC, useState } from 'react';

interface AlbumCardProps {
  artworkUrl: string;
  title: string;
  subtitle: string;
  onClick?: () => void;
  onPlay?: () => void;
}

export const AlbumCard: FC<AlbumCardProps> = ({ artworkUrl, title, subtitle, onClick, onPlay }) => {
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
        <img
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

        {/* Play overlay */}
        <div
          onClick={(e) => {
            if (onPlay) {
              e.stopPropagation();
              onPlay();
            }
          }}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'oklch(0% 0 0 / 0.35)',
            opacity: isHovered ? 1 : 0,
            transition: `opacity var(--duration-normal) var(--ease-out)`,
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-lg)',
              color: 'var(--color-text-primary)',
              transform: isHovered ? 'scale(1)' : 'scale(0.8)',
              transition: `transform var(--duration-normal) var(--ease-out)`,
            }}
          >
            {'\u25B6'}
          </div>
        </div>
      </div>

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
    </button>
  );
};
