import { type FC } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';

interface NowPlayingProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Now Playing — full-page overlay that covers the main content area (between
 * the sidebar and the player bar). Triggered by clicking the cover thumbnail
 * in the PlayerBar; toggling closes it.
 *
 * The cover image is the visual centerpiece, sized to a large square in the
 * middle of the page with the track title and artist beneath it.
 */
export const NowPlaying: FC<NowPlayingProps> = ({ isOpen, onClose }) => {
  const { track } = usePlayerState();

  return (
    <div
      style={{
        position: 'fixed',
        top: 'var(--title-bar-height)',
        left: 'var(--sidebar-width)',
        right: 0,
        bottom: 'var(--player-bar-height)',
        background: 'var(--color-bg)',
        zIndex: 80,
        // Single smooth reveal: opacity + slight rise. Long enough to feel
        // intentional, short enough to not lag the UI. No staggered inner
        // animation — the whole panel moves as one unit.
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? 'translateY(0)' : 'translateY(24px)',
        transformOrigin: 'center center',
        pointerEvents: isOpen ? 'auto' : 'none',
        willChange: 'opacity, transform',
        transition:
          'opacity 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
        overflow: 'hidden',
      }}
      aria-hidden={!isOpen}
    >
      {/* Close (top-right corner) */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close now playing"
        style={{
          position: 'absolute',
          top: 'var(--space-4)',
          right: 'var(--space-5)',
          background: 'none',
          border: 'none',
          color: 'var(--color-text-tertiary)',
          fontSize: 'var(--text-xl)',
          cursor: 'pointer',
          padding: 'var(--space-2)',
          borderRadius: 'var(--radius-sm)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--color-text-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--color-text-tertiary)';
        }}
      >
        ✕
      </button>

      {!track ? (
        <p
          style={{
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-base)',
          }}
        >
          No track playing
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-5)',
            // Fill the container so the cover can grow as large as the
            // viewport allows.
            width: '100%',
            height: '100%',
          }}
        >
          {/* Centered cover — largest square that fits the overlay, bounded
              by viewport height (minus title bar, player bar, our own
              padding, and ~160 px reserved for the title block) and viewport
              width (minus sidebar and our padding). */}
          <div
            style={{
              width:
                'min(calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-6) * 2 - 160px), calc(100vw - var(--sidebar-width) - var(--space-6) * 2))',
              aspectRatio: '1',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              background: 'var(--color-surface-2)',
              boxShadow: '0 24px 60px oklch(0% 0 0 / 0.5)',
              flexShrink: 0,
            }}
          >
            <CachedImage
              src={
                track.artworkUrl ||
                (track.videoId
                  ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`
                  : undefined)
              }
              alt={`${track.title} artwork`}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </div>

          {/* Title + artist */}
          <div
            style={{
              width: 'min(calc(100vw - var(--sidebar-width) - var(--space-6) * 2), 720px)',
              textAlign: 'center',
              minWidth: 0,
            }}
          >
            <MarqueeText
              text={track.title}
              style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.02em',
              }}
            />
            <div
              style={{
                marginTop: 'var(--space-2)',
                fontSize: 'var(--text-base)',
                color: 'var(--color-text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {track.artist}
            </div>
            {track.album && (
              <div
                style={{
                  marginTop: 'var(--space-1)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-tertiary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {track.album}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};
