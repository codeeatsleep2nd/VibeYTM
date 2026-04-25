import { type FC, type ReactNode } from 'react';

const Spinner: FC<{ size?: number }> = ({ size = 40 }) => (
  <div
    role="status"
    aria-label="Loading"
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      border: '3px solid var(--color-surface-3)',
      borderTopColor: 'var(--color-accent)',
      animation: 'vibeytm-spin 0.9s linear infinite',
    }}
  />
);

export const LoadingSpinner: FC = () => (
  <section
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      width: '100%',
    }}
  >
    <Spinner />
  </section>
);

interface ReloadOverlayProps {
  children: ReactNode;
}

// Keeps previously-rendered content visible while a refetch is in flight,
// behind a soft 10 px blur as a visual stale-while-revalidate cue. The
// children stay FULLY INTERACTIVE — `pointer-events` is never set to
// `none` on the wrapper or the children. A small corner spinner sits on
// top with its OWN `pointerEvents: 'none'` so it doesn't intercept
// clicks meant for the cards underneath.
//
// Two regressions to remember (codified in CLAUDE.md "WKWebView quirks"
// and TEST_CHECKLIST.md "WKWebView quirks — REGRESSION TRAPS"):
//
//   1. NEVER add `pointerEvents: 'none'` to the children wrapper. The
//      YTM bridge can stall ~30 s during webview navigation; for that
//      whole window every card on Home/Explore/Library/Search becomes
//      click-dead if pointer events are blocked.
//
//   2. KEEP THE BLUR. The blur is the visual signal that data is being
//      refreshed in place — without it the page looks frozen. An
//      earlier fix removed it together with the click-block in a single
//      sweep; only the click-block was the bug. Restore the blur if it
//      ever disappears again, or any user-facing "wait, is anything
//      happening?" feedback is lost.
export const ReloadOverlay: FC<ReloadOverlayProps> = ({ children }) => (
  <div style={{ position: 'relative', height: '100%', width: '100%' }}>
    <div
      style={{
        height: '100%',
        width: '100%',
        // 10 px blur on the cached content while the refresh is in
        // flight. CSS `filter` does NOT affect hit testing — clicks
        // still pass through to the children — so the cards remain
        // fully interactive even though they look soft.
        filter: 'blur(10px)',
        // Tiny scale-down avoids the blur "halo" leaking past the
        // viewport edge.
        transform: 'scale(0.98)',
        transformOrigin: 'center center',
        transition:
          'filter var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-out)',
      }}
    >
      {children}
    </div>
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'oklch(10% 0.005 270 / 0.25)',
        // The spinner overlay must not intercept clicks meant for the
        // cards underneath it.
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <Spinner />
    </div>
  </div>
);
