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

// Keeps previously-rendered content visible — and INTERACTIVE — while a
// refetch is in flight. A small corner spinner signals the load without
// blocking clicks. The previous version blurred the children and put
// `pointerEvents: 'none'` on both layers, which made every card on the
// page unclickable for the entire duration of the network call. With
// the YTM bridge occasionally hanging for ~30s during webview
// navigation, that turned into a reproducible "all cards unclickable"
// outage. Stale-while-revalidate only works if `stale` stays usable.
export const ReloadOverlay: FC<ReloadOverlayProps> = ({ children }) => (
  <div style={{ position: 'relative', height: '100%', width: '100%' }}>
    {children}
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: 'var(--space-3)',
        right: 'var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // The spinner sits in a corner badge — it must not intercept
        // clicks meant for the cards underneath it.
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <Spinner size={20} />
    </div>
  </div>
);
