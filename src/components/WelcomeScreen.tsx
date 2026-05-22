import { type FC, useEffect, useState } from 'react';
import { AppIcon } from './AppIcon';

interface WelcomeScreenProps {
  /** When true, start fading out; unmounts once the transition finishes. */
  isDone: boolean;
}

const FADE_MS = 450;
/** Period of one full heartbeat (lub-dub + rest) on the splash mark. */
const HEARTBEAT_MS = 1300;

/**
 * Branded splash shown from the first paint of the window until the Home
 * page (or LoginPage) is fully rendered (issue #56). Respects
 * `prefers-reduced-motion` by skipping the fade and the breathing
 * animations.
 *
 * Design (rev 2026-05-09):
 * - Background reuses the same dual-radial ambient washes the app body
 *   uses, so the splash feels continuous with the chrome that fades in
 *   underneath instead of arriving as a separate gradient.
 * - The logo mark is the actual app icon (`AppIcon`, source
 *   `src-tauri/app-icon.svg`) so the splash matches the dock/Finder icon
 *   instead of showing a separate brand mark.
 * - The pulse is now a breathing outer-glow opacity oscillation rather
 *   than a 1.06× transform — flatter motion, no perceptible scale jump,
 *   compositor-only.
 * - The wordmark moves to --text-display so the splash reads as a hero
 *   surface, not a settings dialog.
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
        // Continuous with the app body's ambient gradient (see global.css).
        // Two soft radial washes layered on the base dark surface — the
        // splash and the eventual home page sit on the same canvas, so
        // the fade doesn't introduce a perceptible color shift.
        background: `
          radial-gradient(ellipse 1200px 800px at 15% 10%, var(--ambient-tint-1) 0%, transparent 55%),
          radial-gradient(ellipse 1100px 900px at 85% 95%, var(--ambient-tint-2) 0%, transparent 50%),
          radial-gradient(circle at 50% 50%, oklch(18% 0.04 25) 0%, var(--color-bg) 70%),
          var(--color-bg)
        `,
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
          gap: 'var(--space-6)',
          // `position: relative` so the absolutely-positioned outer glow
          // (below) anchors to this column rather than the viewport.
          position: 'relative',
        }}
      >
        {/* Accent bloom behind the mark. Its opacity flashes on each
            heartbeat (synced to the same period as the icon's scale) so
            the beat reads as a pulse of light, not just a size change.
            Compositor-only via opacity + filter blur; bigger blur radius
            than the icon's drop shadow so the bloom reads as ambient hue,
            not a hard edge. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -32,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 200,
            height: 200,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)',
            filter: 'blur(28px)',
            opacity: 0.4,
            animation: reduceMotion
              ? undefined
              : `vibeytm-welcome-heartbeat-glow ${HEARTBEAT_MS}ms ease-in-out infinite`,
            pointerEvents: 'none',
          }}
        />

        {/* Logo mark — the actual app icon (see src-tauri/app-icon.svg).
            The icon already carries its own glossy red squircle, so the
            mark needs no background plate; the layered drop shadows
            (close-and-dark for grounding, far-and-accent-tinted for
            atmosphere) follow the squircle's alpha shape so the shadow is
            rounded, not a square plate behind a rounded icon.

            Wrapped in a div that runs the heartbeat scale (lub-dub)
            animation. The wrapper (not the SVG) is animated so
            transform-origin: center resolves against a definite box —
            CSS transform-origin on inline SVG is unreliable in this
            WKWebView build. The splash is aria-hidden and non-interactive,
            so the ReloadOverlay transform/hit-testing rule does not apply
            here. */}
        <div
          style={{
            position: 'relative',
            animation: reduceMotion
              ? undefined
              : `vibeytm-welcome-heartbeat ${HEARTBEAT_MS}ms ease-in-out infinite`,
            willChange: reduceMotion ? undefined : 'transform',
          }}
        >
          <AppIcon
            size={112}
            style={{
              display: 'block',
              filter:
                'drop-shadow(0 18px 40px oklch(63% 0.258 29 / 0.45)) drop-shadow(0 2px 12px oklch(0% 0 0 / 0.45))',
            }}
          />
        </div>

        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 'var(--text-display)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.025em',
              lineHeight: 1,
            }}
          >
            VibeYTM
          </div>
          <div
            style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Tuning in…
          </div>
        </div>
      </div>

      <style>{`
        /* Heartbeat: a quick double-thump (lub-dub) then a rest. The two
           scale peaks at 10% and 32% are the two beats; everything after
           46% is the diastolic pause before the next cycle. */
        @keyframes vibeytm-welcome-heartbeat {
          0%, 46%, 100% { transform: scale(1); }
          10%           { transform: scale(1.12); }
          20%           { transform: scale(0.98); }
          32%           { transform: scale(1.09); }
        }
        /* Bloom flashes brighter on each of the two beats, synced to the
           scale keyframes above. */
        @keyframes vibeytm-welcome-heartbeat-glow {
          0%, 46%, 100% { opacity: 0.30; }
          10%           { opacity: 0.74; }
          20%           { opacity: 0.42; }
          32%           { opacity: 0.64; }
        }
      `}</style>
    </div>
  );
};
