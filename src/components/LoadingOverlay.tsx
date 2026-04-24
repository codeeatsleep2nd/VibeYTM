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

// Keeps previously-rendered content visible but blurred while a refetch is
// in flight, with a centered spinner on top. Use when re-fetching data the
// user has already seen — avoids the content-vanishing flash caused by
// swapping in a "Loading…" placeholder.
export const ReloadOverlay: FC<ReloadOverlayProps> = ({ children }) => (
  <div style={{ position: 'relative', height: '100%', width: '100%' }}>
    <div
      aria-hidden
      style={{
        height: '100%',
        width: '100%',
        filter: 'blur(10px)',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'oklch(10% 0.005 270 / 0.35)',
        pointerEvents: 'none',
      }}
    >
      <Spinner />
    </div>
  </div>
);
