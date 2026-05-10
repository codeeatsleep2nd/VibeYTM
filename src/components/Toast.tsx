import { type FC, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2 } from 'lucide-react';
import { toast, useToastState, type ToastSpec } from '../lib/toast';

const DEFAULT_DURATION_MS = 4000;
const ENTER_MS = 240;
const EXIT_MS = 200;
/**
 * Hold between out-animation finishing and a replacement toast's enter
 * animation starting. Avoids the two visually colliding when `toast.show()`
 * is called twice in quick succession.
 */
const REPLACE_HOLD_MS = 40;

/**
 * Bottom-center toast portaled to body. Single-instance — any new toast
 * replaces the current one with a clean out → hold → in sequence.
 *
 * Position is sidebar-aware: the toast horizontally centers on the
 * CONTENT area (right of the sidebar), not the window, so collapsing
 * the sidebar shifts the toast left in lockstep with the player chrome.
 *
 * Renders nothing when no toast is active.
 *
 * Mount once at App.tsx — there's no prop-driven imperative API; the
 * `toast.show(...)` singleton drives this component via the registry.
 */
export const Toast: FC = () => {
  const current = useToastState();
  // Held copy of the current spec so we can keep rendering it during the
  // exit animation after `current` becomes null.
  const [rendered, setRendered] = useState<ToastSpec | null>(null);
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
  const timerRef = useRef<number | null>(null);
  const isHoveredRef = useRef(false);

  // ---- Drive the visible state from the registry's `current`. -----------
  useEffect(() => {
    if (current && rendered?.id !== current.id) {
      // New toast appeared (or replaced an old one).
      if (rendered !== null) {
        // Quick out → hold → in. Old phase first.
        setPhase('exit');
        const exit = window.setTimeout(() => {
          setRendered(current);
          setPhase('enter');
          window.setTimeout(() => setPhase('visible'), 16);
        }, EXIT_MS + REPLACE_HOLD_MS);
        return () => window.clearTimeout(exit);
      }
      setRendered(current);
      setPhase('enter');
      // Next tick → 'visible' so the transform/opacity transition fires.
      const id = window.setTimeout(() => setPhase('visible'), 16);
      return () => window.clearTimeout(id);
    }
    if (!current && rendered !== null) {
      // Programmatically dismissed.
      setPhase('exit');
      const id = window.setTimeout(() => {
        setRendered(null);
        setPhase('enter');
      }, EXIT_MS);
      return () => window.clearTimeout(id);
    }
  }, [current, rendered]);

  // ---- Auto-dismiss timer with hover-pause. -----------------------------
  useEffect(() => {
    if (phase !== 'visible' || rendered === null) return;
    if (isHoveredRef.current) return;
    const ms = rendered.durationMs ?? DEFAULT_DURATION_MS;
    const id = window.setTimeout(() => toast.dismissIf(rendered.id), ms);
    timerRef.current = id;
    return () => {
      window.clearTimeout(id);
      timerRef.current = null;
    };
  }, [phase, rendered]);

  if (rendered === null) return null;

  const visibleStyle: React.CSSProperties =
    phase === 'visible'
      ? { opacity: 1, transform: 'translate(-50%, 0)' }
      : { opacity: 0, transform: 'translate(-50%, 8px)' };

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => {
        isHoveredRef.current = true;
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
        // Restart the auto-dismiss timer from "now" once the user leaves.
        if (rendered !== null && phase === 'visible') {
          const ms = rendered.durationMs ?? DEFAULT_DURATION_MS;
          timerRef.current = window.setTimeout(
            () => toast.dismissIf(rendered.id),
            ms,
          );
        }
      }}
      style={{
        // Sidebar-aware horizontal centering: anchor to the CONTENT area
        // (right of the effective sidebar width). When sidebar is hidden,
        // --sidebar-effective-width is 0 and this falls back to a true
        // window-center. Matches the chrome's left-edge math.
        position: 'fixed',
        bottom:
          'calc(var(--player-bar-height) + var(--space-4) + var(--space-2))',
        left:
          'calc(var(--sidebar-effective-width, var(--sidebar-width)) + (100vw - var(--sidebar-effective-width, var(--sidebar-width))) / 2)',
        transform: 'translate(-50%, 0)',
        zIndex: 300,
        // Glass-tile recipe (rim + thickness + lift). NO backdrop-filter
        // here — issue #99 stacked-glass rule. Player chrome's blur
        // shows through this card's translucent background.
        background: 'var(--glass-bg-card)',
        boxShadow: 'var(--glass-tile-shadow)',
        borderRadius: 'var(--radius-full)',
        padding: 'var(--space-3) var(--space-4)',
        minWidth: 240,
        maxWidth: 380,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color: 'var(--color-text-primary)',
        transition: `opacity ${phase === 'exit' ? EXIT_MS : ENTER_MS}ms var(--ease-out), transform ${phase === 'exit' ? EXIT_MS : ENTER_MS}ms var(--ease-out)`,
        ...visibleStyle,
        userSelect: 'none',
        pointerEvents: phase === 'exit' ? 'none' : 'auto',
      }}
    >
      <CheckCircle2 size={16} color="var(--color-accent)" />
      <span>{rendered.message}</span>
    </div>,
    document.body,
  );
};
