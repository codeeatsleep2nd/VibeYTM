import { type FC, useEffect, useState } from 'react';

interface WelcomeScreenProps {
  /** When true, start fading out; unmounts once the transition finishes. */
  isDone: boolean;
}

const FADE_MS = 450;

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
 * - The logo mark is a real SVG eighth-note inside a soft glass pill;
 *   the previous Unicode `♪` rendered as a system emoji on some font
 *   stacks and broke the dark-luxury feel.
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
        {/* Outer breathing glow. Sits behind the logo pill, opacity
            oscillates so the mark feels like it's softly inhaling
            without any transform jitter. Compositor-only via opacity +
            filter blur. Bigger blur radius than the logo's drop shadow
            so the bloom reads as ambient hue, not a hard edge. */}
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
            opacity: 0.45,
            animation: reduceMotion
              ? undefined
              : 'vibeytm-welcome-breathe 2400ms var(--ease-out) infinite',
            pointerEvents: 'none',
          }}
        />

        {/* Logo pill — real SVG eighth-note inside a glass-tinted square
            with a warm gradient. The pill carries the brand color; the
            mark is white at full opacity so it reads against any blend
            mode underneath. */}
        <div
          style={{
            position: 'relative',
            width: 112,
            height: 112,
            borderRadius: 'var(--radius-xl)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              'linear-gradient(140deg, var(--color-accent-hover) 0%, var(--color-accent) 100%)',
            // Layered drop shadows — close-and-dark for grounding, far-and-
            // accent-tinted for atmosphere.
            boxShadow:
              '0 24px 56px oklch(63% 0.258 29 / 0.40), 0 2px 16px oklch(0% 0 0 / 0.45), inset 0 1px 0 oklch(100% 0 0 / 0.20)',
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="oklch(100% 0 0)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {/* Beamed eighth-notes — two stems joined by a single beam.
                Drawn freehand to match the SF Symbol `music.note` shape:
                left and right note heads as small rounded rects rotated,
                two stems rising to a horizontal beam at the top. Avoids
                the Unicode `♪` glyph that resolved to system emoji on
                some font stacks and read as a default-emoji rather than
                a designed mark. */}
            <ellipse
              cx="6"
              cy="17"
              rx="2.4"
              ry="1.8"
              fill="oklch(100% 0 0)"
              stroke="none"
            />
            <ellipse
              cx="16"
              cy="15"
              rx="2.4"
              ry="1.8"
              fill="oklch(100% 0 0)"
              stroke="none"
            />
            <path d="M8.4 17V6L18.4 4V15" />
            <path d="M8.4 6L18.4 4" strokeWidth="2.2" />
          </svg>
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
        @keyframes vibeytm-welcome-breathe {
          0%, 100% { opacity: 0.32; }
          50%      { opacity: 0.65; }
        }
      `}</style>
    </div>
  );
};
