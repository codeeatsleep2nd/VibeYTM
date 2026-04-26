import { type FC, useEffect } from 'react';
import type { ShortcutBinding } from '../hooks/useGlobalShortcuts';
import { SafeOverlay } from './overlay/SafeOverlay';

interface ShortcutCheatsheetProps {
  isOpen: boolean;
  onClose: () => void;
  bindings: ShortcutBinding[];
}

/**
 * Modal sheet listing every in-app keyboard shortcut. Reads directly
 * from the same `bindings` array that `useGlobalShortcuts` consumes,
 * so the cheatsheet is incapable of drifting from what's actually
 * registered. Triggered by `?` (or `⌘/`).
 *
 * Built on `SafeOverlay` so the four WKWebView click-loss invariants
 * apply automatically — no need to re-invent pointer-events gating
 * for yet another modal surface.
 */
export const ShortcutCheatsheet: FC<ShortcutCheatsheetProps> = ({
  isOpen,
  onClose,
  bindings,
}) => {
  // Close on Escape. Mounted only while open so we don't pay the
  // listener cost otherwise — matches the ContextMenu pattern.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  return (
    <SafeOverlay
      isOpen={isOpen}
      ariaLabel="Keyboard shortcuts"
      slideFrom="bottom"
      zIndex={500}
      background="oklch(0% 0 0 / 0.55)"
      inset={{ top: '0', left: '0', right: '0', bottom: '0' }}
    >
      <button
        type="button"
        aria-label="Close shortcut cheatsheet"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'default',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(520px, calc(100vw - var(--space-12)))',
          maxHeight: 'calc(100vh - var(--space-12))',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 24px 80px oklch(0% 0 0 / 0.6)',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          overflow: 'hidden',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: 'var(--color-text-primary)',
            }}
          >
            Keyboard shortcuts
          </h2>
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            Esc to close
          </span>
        </header>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            overflowY: 'auto',
          }}
        >
          {bindings.map((b) => (
            <li
              key={`${b.key}-${b.hint}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-sm)',
              }}
            >
              <span style={{ color: 'var(--color-text-primary)' }}>{b.label}</span>
              <kbd
                style={{
                  fontFamily: 'inherit',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-surface-3)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid oklch(100% 0 0 / 0.06)',
                }}
              >
                {b.hint}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </SafeOverlay>
  );
};
