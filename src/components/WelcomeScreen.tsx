import { type FC, useEffect, useState } from 'react';

interface WelcomeScreenProps {
  /** When true, start fading out; unmounts once the transition finishes. */
  isDone: boolean;
}

const FADE_MS = 450;

/**
 * Branded splash shown from the first paint of the window until the Home
 * page (or LoginPage) is fully rendered (issue #56). Respects
 * `prefers-reduced-motion` by skipping the fade transition.
 */
export const WelcomeScreen: FC<WelcomeScreenProps> = ({ isDone }) => {
  const [isMounted, setIsMounted] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    if (!isDone) return;
    if (reduceMotion) {
      setIsMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setIsMounted(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [isDone, reduceMotion]);

  if (!isMounted) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at 50% 35%, oklch(22% 0.02 25 / 1) 0%, var(--color-bg) 75%)',
        opacity: isDone && !reduceMotion ? 0 : 1,
        transition: reduceMotion
          ? 'none'
          : `opacity ${FADE_MS}ms var(--ease-out)`,
        pointerEvents: isDone ? 'none' : 'auto',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-5)',
        }}
      >
        {/* Logo mark — a glowing musical note in the app's accent color */}
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 'var(--radius-xl)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              'linear-gradient(140deg, var(--color-accent-hover) 0%, var(--color-accent) 100%)',
            boxShadow:
              '0 20px 48px oklch(62% 0.24 25 / 0.35), 0 2px 12px oklch(0% 0 0 / 0.4)',
            fontSize: 56,
            lineHeight: 1,
            color: 'oklch(100% 0 0)',
            animation: reduceMotion
              ? undefined
              : 'vibeytm-welcome-pulse 1800ms var(--ease-out) infinite',
          }}
        >
          {'♪'}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            VibeYTM
          </div>
          <div
            style={{
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)',
              letterSpacing: '0.02em',
            }}
          >
            Tuning in…
          </div>
        </div>
      </div>

      <style>{`
        @keyframes vibeytm-welcome-pulse {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.06); filter: brightness(1.1); }
        }
      `}</style>
    </div>
  );
};
