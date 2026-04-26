import { type FC } from 'react';
import type { CoverColors } from '../../../lib/coverColors';

interface CoverBackdropProps {
  colors: CoverColors;
}

/**
 * Soft cover-tinted backdrop rendered behind the Now Playing hero. Two
 * radial gradients positioned at opposite corners give the panel a
 * dynamic "glow" that picks up the album art's mood — Apple-Music style.
 *
 * The whole layer is `position: absolute; inset: 0; pointer-events: none`
 * so it sits behind interactive content and doesn't hijack hit-testing.
 * Color transitions on track change are handled via CSS `transition` on
 * `background-image` — the browser interpolates between the two gradient
 * specifications smoothly.
 */
export const CoverBackdrop: FC<CoverBackdropProps> = ({ colors }) => {
  // Two-corner gradient: primary in the top-left, secondary in the
  // bottom-right, with the page background mixing in toward the
  // opposite corners. Higher alpha at the source corners; fades to
  // transparent so the inner panel remains readable.
  const background = `
    radial-gradient(60% 70% at 12% 8%, ${withAlpha(colors.primary, 0.45)} 0%, transparent 70%),
    radial-gradient(70% 80% at 92% 95%, ${withAlpha(colors.secondary, 0.42)} 0%, transparent 75%),
    var(--color-bg)
  `;

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        background,
        pointerEvents: 'none',
        // Slightly long transition so abrupt track-change flips look
        // smooth, not jarring. The two gradients both crossfade.
        transition: 'background 700ms var(--ease-out)',
        zIndex: 0,
      }}
    />
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
