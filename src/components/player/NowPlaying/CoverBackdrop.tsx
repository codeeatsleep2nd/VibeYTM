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
export const CoverBackdrop: FC<CoverBackdropProps> = () => {
  // The playing-page background no longer tints to the song's cover
  // colours (per request) — it stays a uniform neutral wash regardless
  // of the current track. The blurred backdrop visible behind the
  // panel comes from the parent SafeOverlay's `backdrop-filter:
  // var(--glass-recipe-strong)` which frosts the page underneath the
  // overlay. This component now only owns the ambient gradient seen
  // layered on top of that frost.
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        background: 'transparent',
        overflow: 'hidden',
      }}
    />
  );
};

