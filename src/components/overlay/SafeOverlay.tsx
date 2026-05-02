import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useState,
} from 'react';

/**
 * Overlay-scoped open state. Children that want to set their own
 * `pointer-events: auto` (e.g. a column inside Now Playing that
 * intercepts wheel events) MUST AND with this so a closed overlay
 * never steals clicks from the page behind it. See
 * `src/components/player/NowPlaying.tsx` line 198 history for the
 * regression that motivated this contract.
 */
const OverlayContext = createContext<{ isOpen: boolean }>({ isOpen: false });

export const useOverlayOpen = (): boolean => useContext(OverlayContext).isOpen;

interface SafeOverlayInset {
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
}

type SlideDirection = 'bottom' | 'right';

interface SafeOverlayProps {
  isOpen: boolean;
  children: ReactNode;
  /** Override individual sides; defaults to the standard sidebar+chrome inset. */
  inset?: SafeOverlayInset;
  zIndex?: number;
  background?: string;
  /**
   * Entrance direction:
   *   - `bottom` (default): slide up from below the window with opacity
   *     fade — for full-page panels. Closing reverses the motion so the
   *     panel slides back down off the bottom edge.
   *   - `right`: slide in from off-screen right at full opacity — for drawers.
   *
   * Both motions are translate-only. Scale is forbidden in either branch
   * because of the WKWebView hit-test bug (see test suite contracts).
   */
  slideFrom?: SlideDirection;
  /**
   * @deprecated Use `slideFrom`. Kept temporarily so any external caller
   * passing `rise={false}` doesn't silently animate.
   */
  rise?: boolean;
  ariaLabel?: string;
  role?: string;
  boxShadow?: string;
  /** Element tag for the wrapper. Defaults to `div`. */
  as?: 'div' | 'aside' | 'section';
  /** Optional padding shorthand (applied to the wrapper). */
  padding?: string | { top?: string; right?: string; bottom?: string; left?: string };
  /** Display layout on the wrapper (defaults to block). Used by drawers
   *  that want their own children to flex-stack inside the wrapper. */
  display?: CSSProperties['display'];
  flexDirection?: CSSProperties['flexDirection'];
  /** Optional className applied to the wrapper. */
  className?: string;
  /** Optional CSS `backdrop-filter` (and `-webkit-backdrop-filter`) for
   *  drawers that want a Liquid-Glass surface. Translucent backgrounds
   *  on `position:fixed` overlays look flat without it. */
  backdropFilter?: string;
  /** Optional rounded corners. Used when the drawer should read as a
   *  floating glass card rather than a slab pinned to a window edge. */
  borderRadius?: CSSProperties['borderRadius'];
  /** Optional border (e.g., `1px solid var(--glass-rim-mid)`). */
  border?: CSSProperties['border'];
}

const DEFAULT_INSET: Required<SafeOverlayInset> = {
  top: 'var(--title-bar-height)',
  left: 'var(--sidebar-width)',
  right: '0',
  bottom: 'var(--player-bar-height)',
};

/**
 * SafeOverlay — single primitive for any fixed-position drawer or panel
 * that overlays the main content area. Encodes four WKWebView-specific
 * invariants that have each shipped as a regression in the past:
 *
 *   1. The wrapper's `pointer-events` is always AND-ed with `isOpen`,
 *      so a closed overlay never steals clicks from the page behind.
 *   2. The wrapper NEVER uses `transform: scale(...)`. WKWebView
 *      mishandles the stacking context that creates and clicks on
 *      cards underneath silently stop registering. Only `translateY`
 *      is allowed for the entrance.
 *   3. Children that themselves toggle `pointer-events: auto` consume
 *      `useOverlayOpen()` and AND with it — so opening a sub-feature
 *      inside a closed overlay can never leave a click-stealing region.
 *   4. `aria-hidden` flips with `isOpen` so assistive tech and tab
 *      navigation never dive into an invisible panel.
 *
 * All four are covered by `SafeOverlay.test.tsx`. Edits to this file
 * MUST keep that suite green.
 */
export const SafeOverlay = forwardRef<HTMLElement, SafeOverlayProps>(function SafeOverlay(
  {
    isOpen,
    children,
    inset,
    zIndex = 80,
    background = 'var(--color-bg)',
    slideFrom = 'bottom',
    rise,
    ariaLabel,
    role,
    boxShadow,
    as = 'div',
    padding,
    display,
    flexDirection,
    className,
    backdropFilter,
    borderRadius,
    border,
  },
  ref,
) {
  const top = inset?.top ?? DEFAULT_INSET.top;
  const left = inset?.left ?? DEFAULT_INSET.left;
  const right = inset?.right ?? DEFAULT_INSET.right;
  const bottom = inset?.bottom ?? DEFAULT_INSET.bottom;

  // Permanent `willChange: 'opacity, transform'` keeps WKWebView's GPU
  // layer for this overlay promoted forever — fine on its own, but when
  // two SafeOverlays both with `backdrop-filter` stack in the same
  // screen region (e.g. NowPlaying + LyricsOverlay or NowPlaying +
  // QueuePanel), WKWebView enters a paint feedback loop and the user
  // sees continuous flicker (issue #99). Demote the layer to `auto`
  // once the entrance/exit transition completes so the GPU stops
  // re-rasterising it every frame.
  const [transitioning, setTransitioning] = useState(false);
  useEffect(() => {
    setTransitioning(true);
    // Match the 420 ms transition duration below; small slack so the
    // demote happens after the last animation frame.
    const handle = setTimeout(() => setTransitioning(false), 480);
    return () => clearTimeout(handle);
  }, [isOpen]);

  // Back-compat: an explicit `rise={false}` disables the entrance entirely
  // (transform stays `none`). New callers should use `slideFrom`.
  const effectiveSlide: SlideDirection | 'none' =
    rise === false ? 'none' : slideFrom;

  let transform: string;
  let opacityWhenClosed: number;
  switch (effectiveSlide) {
    case 'right':
      // Slide off-screen by 100% PLUS the right inset, otherwise a
      // sliver of the panel's left edge equal to `inset.right` stays
      // visible when closed (the translate moves the panel by its own
      // width, but the panel sits offset by `right` from the window
      // edge, so 100% only covers the gap between left/right edges of
      // the panel itself, not the right margin). Opacity also drops to
      // 0 as a belt-and-braces guard against any sub-pixel artifact.
      transform = isOpen
        ? 'translateX(0px)'
        : `translateX(calc(100% + ${right}))`;
      opacityWhenClosed = 0;
      break;
    case 'none':
      transform = 'none';
      opacityWhenClosed = 0;
      break;
    case 'bottom':
    default:
      // Translate by the panel's full height so it slides clear off the
      // bottom edge of its inset rect — both opening (rising up) and
      // closing (sliding back down) read as a smooth full-distance
      // motion, not a 24 px lift.
      transform = isOpen ? 'translateY(0px)' : 'translateY(100%)';
      opacityWhenClosed = 0;
      break;
  }

  const paddingStyle: Pick<
    CSSProperties,
    'padding' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
  > =
    typeof padding === 'string'
      ? { padding }
      : padding
        ? {
            paddingTop: padding.top,
            paddingRight: padding.right,
            paddingBottom: padding.bottom,
            paddingLeft: padding.left,
          }
        : {};

  const style: CSSProperties & { WebkitBackdropFilter?: string } = {
    position: 'fixed',
    top,
    left,
    right,
    bottom,
    background,
    zIndex,
    opacity: isOpen ? 1 : opacityWhenClosed,
    // Only translateX/translateY are permitted — no `scale(...)`
    // (WKWebView hit-test bug, see SafeOverlay.test.tsx contracts).
    transform,
    pointerEvents: isOpen ? 'auto' : 'none',
    // Only hint willChange while the overlay is animating. Permanent
    // GPU promotion stacks badly with backdrop-filter layers in
    // WKWebView (issue #99).
    willChange: transitioning ? 'opacity, transform' : 'auto',
    // Opacity and transform share the same 420 ms cubic-bezier so the
    // closing motion plays at exactly the same speed as the opening
    // motion. Previously opacity used the shorter `--duration-normal`
    // (200 ms), which made the close fade out before the slide-down
    // could finish — felt twice as fast as the open.
    transition:
      'opacity 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
    boxShadow,
    borderRadius,
    border,
    display,
    flexDirection,
    overflow: display === 'flex' ? 'hidden' : undefined,
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    ...paddingStyle,
  };

  const Tag = as;
  return (
    <OverlayContext.Provider value={{ isOpen }}>
      <Tag
        ref={ref as Ref<HTMLDivElement & HTMLElement>}
        className={className}
        role={role}
        aria-label={ariaLabel}
        aria-hidden={!isOpen}
        style={style}
      >
        {children}
      </Tag>
    </OverlayContext.Provider>
  );
});
