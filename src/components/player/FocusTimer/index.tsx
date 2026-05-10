import { type FC, useEffect } from 'react';
import { LiquidGlass } from '@liquidglass/react';
import { SafeOverlay } from '../../overlay/SafeOverlay';
import { notificationApi } from '../../../lib/ipc';
import { debug } from '../../../lib/debug';
import {
  type FocusTimerState,
  useFocusTimerCountdown,
} from './useFocusTimerCountdown';

interface FocusTimerProps {
  isOpen: boolean;
  /**
   * Called whenever the user requests to close the page (X button or
   * Reset button). The PARENT decides whether to gate this on a
   * confirmation — internal state is reported via `onStateChange` so
   * the parent can read it without rendering twice. This keeps every
   * close-path (sidebar nav, clock toggle, X button, etc.) routed
   * through the same App-level gate.
   */
  onClose: () => void;
  /** Reports state transitions (idle/running/done) so the App-level
   *  gate can decide whether to prompt before letting any close happen. */
  onStateChange?: (state: FocusTimerState) => void;
}

// Preset durations exposed as chips. Picked to cover the most common
// focus patterns without flooding the UI: a sub-Pomodoro warm-up (15),
// classic Pomodoro (25), one-task block (45), classic hour, deep-work
// session (90). Drops the slider's 5-min and 120-min edges — those
// were rarely used and not worth a slider's chrome.
const PRESET_MINUTES = [15, 25, 45, 60, 90] as const;
const DEFAULT_SECS = 25 * 60;

// Ring geometry. Sized so the ring is the page's focal element — about
// 60% of the surrounding card's max width. The stroke is thick enough
// to register against the dark glass without dominating; the radius
// leaves half-stroke breathing room inside the SVG viewBox.
const RING_SIZE = 280;
const RING_STROKE = 6;
const RING_RADIUS = RING_SIZE / 2 - RING_STROKE / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatRemaining(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Focus timer — full-page overlay that mirrors NowPlaying's surface
 * style (slide-from-bottom, heavy backdrop blur, sidebar visible on
 * the left). Single-shot: pick a duration with the preset chips, hit
 * Start, watch the circular countdown ring fill, get a system
 * notification when it hits 0.
 *
 * Layout (top to bottom):
 *   ┌───────────────────────────────┐
 *   │       FOCUS SESSION           │  eyebrow (state label)
 *   │     ╭───────────────╮         │
 *   │    │      25:00      │  ring  │  circular progress + time
 *   │     ╰───────────────╯         │
 *   │   Pick a duration and start.  │  subhead
 *   │   [15] [25] [45] [60] [90]    │  preset chips
 *   │          [ Start ]            │  primary CTA
 *   └───────────────────────────────┘
 *
 * Close affordances are gated through the parent: while the timer is
 * running, both the explicit close button and the Reset button pop a
 * confirmation modal. Idle and Done states close without prompting.
 */
export const FocusTimer: FC<FocusTimerProps> = ({
  isOpen,
  onClose,
  onStateChange,
}) => {
  const {
    state,
    totalSecs,
    remainingSecs,
    setDuration,
    start,
    reset,
  } = useFocusTimerCountdown({
    initialDurationSecs: DEFAULT_SECS,
    onComplete: () => {
      notificationApi
        .show(
          'Focus session complete',
          'You made it, time to take a break.',
        )
        .catch((e: unknown) => {
          debug.error('FocusTimer', 'notification failed', e);
        });
    },
  });

  // Bubble state transitions up so App.tsx can decide whether to
  // prompt before any close path completes (sidebar nav, clock toggle,
  // X button, Reset button — all routed through the parent gate).
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  // Reset internal state every time the overlay closes so the next
  // open is always fresh — matches the "timer should reset if the app
  // is closed" invariant applied to overlay close.
  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  const headline = state === 'done' ? 'Done' : 'Focus session';
  const subhead =
    state === 'done'
      ? 'You made it, time to take a break.'
      : state === 'running'
        ? 'Stay focused — you can reset anytime.'
        : 'Pick a duration and start your session.';

  // Progress fraction of the chosen duration that has elapsed. Clamped
  // so the ring never overshoots due to rounding at the boundaries.
  const progress =
    state === 'idle'
      ? 0
      : Math.max(0, Math.min(1, (totalSecs - remainingSecs) / totalSecs));
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <SafeOverlay
      isOpen={isOpen}
      ariaLabel="Focus timer"
      slideFrom="bottom"
      zIndex={80}
      inset={{
        top: '0',
        left: 'var(--sidebar-width)',
        right: '0',
        bottom: '0',
      }}
      background="transparent"
      backdropFilter="blur(40px) saturate(180%)"
      boxShadow="0 -8px 32px oklch(0% 0 0 / 0.35)"
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <LiquidGlass
          borderRadius={32}
          blur={0}
          contrast={1.1}
          brightness={1.04}
          saturation={1.4}
          shadowIntensity={0.4}
          displacementScale={1}
          elasticity={1}
        >
          <div
            style={{
              padding: 'var(--space-8) var(--space-10)',
              minWidth: 480,
              maxWidth: 560,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-5)',
              borderRadius: 'inherit',
              background: 'oklch(15% 0 0 / 0.55)',
            }}
          >
            <div
              style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              {headline}
            </div>

            {/* Circular progress ring with the time centered inside.
                The SVG is decorative; the timer announcement lives on
                the inner div so screen readers don't double-read the
                ring's stroke geometry. */}
            <div
              style={{
                position: 'relative',
                width: RING_SIZE,
                height: RING_SIZE,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                aria-hidden
                width={RING_SIZE}
                height={RING_SIZE}
                viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                style={{ position: 'absolute', inset: 0 }}
              >
                {/* Track — the unfilled portion of the ring. White at
                    very low alpha so it reads against the dark glass
                    without competing with the accent fill. */}
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="oklch(100% 0 0 / 0.08)"
                  strokeWidth={RING_STROKE}
                />
                {/* Progress — accent stroke. Rotated -90° so the start
                    of the dash is at 12 o'clock; rounded cap softens
                    the leading edge as it sweeps. */}
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                  style={{
                    transition:
                      'stroke-dashoffset 1s linear, stroke 200ms var(--ease-out)',
                  }}
                />
              </svg>
              <div
                role="timer"
                aria-live="polite"
                style={{
                  fontSize: 'clamp(56px, 9vw, 88px)',
                  fontWeight: 200,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--color-text-primary)',
                  letterSpacing: '-0.04em',
                  lineHeight: 1,
                }}
              >
                {formatRemaining(remainingSecs)}
              </div>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-tertiary)',
                textAlign: 'center',
                maxWidth: 360,
                lineHeight: 1.5,
              }}
            >
              {subhead}
            </p>

            {/* Preset chips — only meaningful while the timer can be
                reconfigured (idle or done). Disabled mid-run; the
                hook's setDuration is a no-op there but disabling the
                chips makes the affordance match the truth. */}
            <div
              role="group"
              aria-label="Focus duration presets"
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              {PRESET_MINUTES.map((min) => {
                const secs = min * 60;
                const isActive = totalSecs === secs;
                const isDisabled = state === 'running';
                return (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setDuration(secs)}
                    disabled={isDisabled}
                    aria-pressed={isActive}
                    aria-label={`${min} minutes`}
                    style={{
                      flexShrink: 0,
                      padding: 'var(--space-2) var(--space-4)',
                      minWidth: 56,
                      fontSize: 'var(--text-sm)',
                      fontWeight: isActive ? 600 : 500,
                      borderRadius: 'var(--radius-full)',
                      border: isActive
                        ? 'none'
                        : '1px solid var(--color-border)',
                      background: isActive
                        ? 'oklch(100% 0 0 / 0.10)'
                        : 'transparent',
                      color: isActive
                        ? 'var(--color-accent)'
                        : 'var(--color-text-secondary)',
                      cursor: isDisabled ? 'default' : 'pointer',
                      opacity: isDisabled ? 0.5 : 1,
                      transition: `background var(--duration-fast) var(--ease-out),
                                   color var(--duration-fast) var(--ease-out),
                                   opacity var(--duration-fast) var(--ease-out)`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {min}
                  </button>
                );
              })}
            </div>

            {/* Primary CTA changes by state. */}
            {state === 'idle' && (
              <button
                type="button"
                onClick={start}
                style={{
                  padding: 'var(--space-3) var(--space-10)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 600,
                  color: 'white',
                  background: 'var(--color-accent)',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  cursor: 'pointer',
                  transition: 'opacity var(--duration-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.9';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1';
                }}
              >
                Start
              </button>
            )}
            {state === 'running' && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: 'var(--space-3) var(--space-10)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-full)',
                  cursor: 'pointer',
                  transition: 'background var(--duration-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Reset
              </button>
            )}
            {state === 'done' && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: 'var(--space-3) var(--space-10)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 600,
                  color: 'white',
                  background: 'var(--color-accent)',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  cursor: 'pointer',
                  transition: 'opacity var(--duration-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.9';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1';
                }}
              >
                Close
              </button>
            )}
          </div>
        </LiquidGlass>
      </div>
    </SafeOverlay>
  );
};
