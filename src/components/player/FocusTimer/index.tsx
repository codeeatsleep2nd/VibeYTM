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

const MIN_SECS = 5 * 60;
const MAX_SECS = 120 * 60;
const STEP_SECS = 5 * 60;
const DEFAULT_SECS = 25 * 60;

function formatRemaining(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Focus timer — full-page overlay that mirrors NowPlaying's surface
 * style (slide-from-bottom, heavy backdrop blur, sidebar visible on
 * the left). Single-shot: pick a duration with the slider, hit Start,
 * watch the countdown, get a system notification when it hits 0.
 *
 * Close affordances are gated through `tryClose`: while the timer is
 * running, both the explicit close button and the Reset button pop a
 * confirmation modal. Idle and Done states close without prompting.
 *
 * Sidebar nav resets the timer at the App level (silent, mirrors how
 * the queue / lyrics / nowplaying overlays behave) — the confirmation
 * modal is only for close paths originating from inside this page,
 * matching the user's "anything in the page" wording.
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
          // Surface to the Rust dev-terminal so issues are visible.
          // The "Done" view is still the in-app visual confirmation.
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

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDuration(Number(e.target.value));
  };

  const headline =
    state === 'done' ? 'Done' : 'Focus session';
  const subhead =
    state === 'done'
      ? 'You made it, time to take a break.'
      : state === 'running'
        ? 'Stay focused — you can reset anytime.'
        : 'Pick a duration and start your session.';

  const progressPct =
    state === 'running' || state === 'done'
      ? Math.max(0, Math.min(100, ((totalSecs - remainingSecs) / totalSecs) * 100))
      : 0;

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
        {/* Centered card. LiquidGlass rim matches the surface used by
            NowPlaying's cover capsule, scaled to a content card. The
            page has no close-affordance of its own — exit goes through
            the chrome's clock toggle, which routes through the App-
            level confirmation gate. */}
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
              background:
                'oklch(15% 0 0 / 0.55)',
            }}
          >
            <div
              style={{
                fontSize: 'var(--text-base)',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {headline}
            </div>

            <div
              role="timer"
              aria-live="polite"
              style={{
                fontSize: 'clamp(64px, 12vw, 128px)',
                fontWeight: 200,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              {formatRemaining(remainingSecs)}
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

            {/* Slider — only interactive while idle. While running/done
                we still render it (with the active-progress fill) so
                the layout doesn't shift. */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <input
                type="range"
                min={MIN_SECS}
                max={MAX_SECS}
                step={STEP_SECS}
                value={state === 'idle' ? remainingSecs : totalSecs}
                onChange={handleSlider}
                disabled={state === 'running'}
                aria-label="Focus duration in seconds"
                style={{
                  width: '100%',
                  cursor: state === 'running' ? 'default' : 'pointer',
                  accentColor: 'var(--color-accent)',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                <span>5 min</span>
                <span>120 min</span>
              </div>
              {(state === 'running' || state === 'done') && (
                <div
                  aria-hidden
                  style={{
                    width: '100%',
                    height: 4,
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: 2,
                    overflow: 'hidden',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  <div
                    style={{
                      width: `${progressPct}%`,
                      height: '100%',
                      background: 'var(--color-accent)',
                      transition: 'width var(--duration-normal) var(--ease-out)',
                    }}
                  />
                </div>
              )}
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
