import { type CSSProperties, type FC, useEffect, useState } from 'react';

interface SkeletonProps {
  /** Width in pixels (number) or any CSS dimension string. */
  width?: number | string;
  /** Height in pixels (number) or any CSS dimension string. */
  height?: number | string;
  /** When set, the element keeps `width` and derives height from this
   *  ratio. Use 1 for square covers, 16/9 for wide thumbs. */
  aspect?: number;
  /** Border radius — number → pixels, string → verbatim. Defaults to
   *  the shared --radius-sm token via fallback. */
  radius?: number | string;
  /** Optional inline style override merged last. */
  style?: CSSProperties;
}

/**
 * Single skeleton placeholder rectangle. Apple-Music-style: a slightly
 * lighter base over the page surface, with a single white-ish gleam
 * sweeping left-to-right at a deliberate cadence.
 *
 * Shimmer uses `transform: translateX(...)` on a pseudo-overlay so the
 * animation runs on the compositor, never triggers paint or layout.
 * Respects `prefers-reduced-motion: reduce` — no animation in that
 * case.
 *
 * Locked-in invariants (covered by Skeleton.test.tsx):
 *   - `transform: scale(...)` never appears (WKWebView hit-test rule)
 *   - shimmer never animates `background-position` (paint-bound)
 *   - reduced-motion mode mounts no animated overlay
 */
export const Skeleton: FC<SkeletonProps> = ({
  width,
  height,
  aspect,
  radius,
  style,
}) => {
  const reduced = useReducedMotion();
  const w = typeof width === 'number' ? `${width}px` : width;
  const h = typeof height === 'number' ? `${height}px` : height;
  const r = typeof radius === 'number' ? `${radius}px` : radius;

  return (
    <div
      aria-hidden
      style={{
        width: w,
        height: h,
        aspectRatio: aspect,
        borderRadius: r ?? 'var(--radius-sm)',
        background: 'oklch(100% 0 0 / 0.06)',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      {!reduced && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            // The gleam is a horizontal gradient that travels through
            // the element via transform. translateX is compositor-only
            // — no paint per frame.
            background:
              'linear-gradient(90deg, transparent 0%, oklch(100% 0 0 / 0.07) 50%, transparent 100%)',
            transform: 'translateX(-100%)',
            animation: 'vibeytm-skeleton-shimmer 1500ms ease-in-out infinite',
            willChange: 'transform',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
};

/**
 * Skeleton for a typical song-row layout (track number, square cover,
 * title + artist text stack, duration). Mirror the dims of SongRow so
 * the swap on data-arrival doesn't cause layout shift.
 */
export const SkeletonRow: FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-2) var(--space-3)',
      width: '100%',
    }}
  >
    <Skeleton width={24} height={14} />
    <Skeleton width={40} height={40} radius={4} />
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}
    >
      <Skeleton width="40%" height={12} />
      <Skeleton width="25%" height={10} />
    </div>
    <Skeleton width={32} height={10} />
  </div>
);

/**
 * Skeleton for an album / playlist card (square cover + 1-2 lines of
 * text). Used by HomePage shelves, ArtistPage albums grid, search
 * Albums tab.
 */
export const SkeletonCard: FC<{ size?: number }> = ({ size = 168 }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      width: size,
    }}
  >
    <Skeleton width={size} aspect={1} radius={'var(--radius-md)'} />
    <Skeleton width="80%" height={12} />
    <Skeleton width="55%" height={10} />
  </div>
);

/**
 * Skeleton scaffold for a detail-page hero. Matches DetailPageHero's
 * grid (cover + kind/title/meta column) so the data-arrival swap
 * doesn't jolt the layout.
 */
export const SkeletonDetailHero: FC = () => (
  <header
    style={{
      minHeight: 320,
      padding: 'var(--space-3) var(--space-6) var(--space-6)',
      background: 'var(--color-bg)',
    }}
  >
    <Skeleton width={32} height={32} radius={'var(--radius-full)'} />
    <div
      style={{
        marginTop: 'var(--space-4)',
        display: 'grid',
        gridTemplateColumns: '208px 1fr',
        gap: 'var(--space-5)',
        alignItems: 'flex-end',
      }}
    >
      <Skeleton width={208} height={208} radius={'var(--radius-lg)'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <Skeleton width={60} height={10} />
        <Skeleton width="60%" height={28} />
        <Skeleton width="30%" height={14} />
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <Skeleton width={92} height={36} radius={'var(--radius-full)'} />
          <Skeleton width={120} height={36} radius={'var(--radius-full)'} />
        </div>
      </div>
    </div>
  </header>
);

// Sniff prefers-reduced-motion once on mount and react to changes.
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

// Inject the shimmer keyframes once at module load — kept out of
// global.css so the animation lives next to the component that owns it.
if (typeof document !== 'undefined' && !document.getElementById('vibeytm-skeleton-shimmer-keyframes')) {
  const style = document.createElement('style');
  style.id = 'vibeytm-skeleton-shimmer-keyframes';
  style.textContent = `@keyframes vibeytm-skeleton-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }`;
  document.head.appendChild(style);
}
