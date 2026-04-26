import { type FC } from 'react';
import type { CoverColors } from '../../../lib/coverColors';

interface CoverBackdropProps {
  colors: CoverColors;
  /** When provided, render a heavy-blurred copy of the cover art behind
   *  the gradient — gives the panel real depth instead of just tint. */
  coverUrl?: string | null;
}

/**
 * Layered Now-Playing backdrop:
 *
 *   1. Heavy-blurred album art (when `coverUrl` is provided) — gives
 *      the panel real depth, Apple-Music style. Scaled up so the blur
 *      halo doesn't reveal the page edges.
 *   2. Two cover-tinted radial gradients on top — pick up the album's
 *      dominant + secondary colors as a soft glow.
 *   3. The bg color underneath as the final fallback.
 *
 * The whole stack is `position: absolute; inset: 0; pointer-events: none`
 * so it sits behind interactive content and doesn't hijack hit-testing.
 * Each layer crossfades on track change via CSS `transition`.
 */
export const CoverBackdrop: FC<CoverBackdropProps> = ({ colors, coverUrl }) => {
  // Two-corner gradient: primary in the top-left, secondary in the
  // bottom-right. Higher alpha when there's no cover image behind so
  // the panel isn't dim; lower alpha when there IS a cover image so
  // the cover's color comes through.
  const tintAlphaPrimary = coverUrl ? 0.32 : 0.45;
  const tintAlphaSecondary = coverUrl ? 0.3 : 0.42;
  const tintBackground = `
    radial-gradient(60% 70% at 12% 8%, ${withAlpha(colors.primary, tintAlphaPrimary)} 0%, transparent 70%),
    radial-gradient(70% 80% at 92% 95%, ${withAlpha(colors.secondary, tintAlphaSecondary)} 0%, transparent 75%)
  `;

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        background: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      {coverUrl && (
        <div
          style={{
            position: 'absolute',
            // Scale up so the blur halo never reveals the inner edges.
            inset: '-12%',
            backgroundImage: `url("${coverUrl}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            // Heavy blur + slight desaturation so the cover reads as
            // atmospheric rather than competing with the foreground
            // hero. The brightness clamp keeps very-bright covers from
            // washing out the lyric and title text.
            filter: 'blur(80px) saturate(120%) brightness(0.55)',
            transition: 'filter 700ms var(--ease-out), opacity 700ms var(--ease-out)',
            opacity: 0.7,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: tintBackground,
          // Slightly long transition so abrupt track-change flips look
          // smooth, not jarring. The two gradients both crossfade.
          transition: 'background 700ms var(--ease-out)',
        }}
      />
    </div>
  );
};

/**
 * Tack a CSS color-mix alpha onto an `rgb(...)` or `oklch(...)` string.
 * Preserves the source color's intent and works regardless of which
 * format the palette extractor returned.
 */
function withAlpha(color: string, alpha: number): string {
  // Modern CSS `color-mix` interpolates with transparent — uniform
  // alpha mechanism that works for both rgb() and oklch() sources.
  const pct = Math.round(alpha * 100);
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`;
}
