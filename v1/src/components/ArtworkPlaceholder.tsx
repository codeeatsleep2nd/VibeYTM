import type { CSSProperties, FC } from 'react';

interface ArtworkPlaceholderProps {
  style?: CSSProperties;
  /** Pixel size hint used to scale the music-note glyph. */
  size?: number;
}

/**
 * Shown in place of a track's cover when no album-art URL is
 * available. The user-facing rule (set after the counterpart-artwork
 * landing) is: NEVER fall back to a YouTube video thumbnail. A
 * generic music-note placeholder reads as "we don't have a cover
 * for this yet" rather than "broken thumbnail" or "wrong image."
 */
export const ArtworkPlaceholder: FC<ArtworkPlaceholderProps> = ({
  style,
  size,
}) => (
  <div
    aria-hidden
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      background:
        'linear-gradient(135deg, oklch(28% 0.02 270) 0%, oklch(20% 0.015 280) 100%)',
      color: 'oklch(60% 0.04 280)',
      fontSize: size ? `${Math.max(12, Math.round(size * 0.4))}px` : 'var(--text-2xl)',
      lineHeight: 1,
      userSelect: 'none',
      ...style,
    }}
  >
    {'♫'}
  </div>
);
