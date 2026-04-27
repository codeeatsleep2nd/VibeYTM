import { useEffect } from 'react';

export type ShortcutCallback = () => void;

export interface ShortcutBinding {
  /** Lower-case key as reported by KeyboardEvent.key — e.g. 'l', 'q', ' '. */
  key: string;
  /** Require ⌘ (mac) / Ctrl (win/linux). */
  meta?: boolean;
  /** Require ⌥ (alt). */
  alt?: boolean;
  /** Require ⇧ (shift). */
  shift?: boolean;
  /** Human-readable label for the cheatsheet. */
  label: string;
  /** Pretty-printed shortcut for the cheatsheet, e.g. "⌘L". */
  hint: string;
  /** Fire when the user presses this combo. The handler MUST guard
   *  against firing while focus is in a text input — `useGlobalShortcuts`
   *  does that gating itself. */
  onActivate: ShortcutCallback;
}

/**
 * Editable input elements where global shortcuts must NOT fire — the
 * user is typing, not navigating the app. Includes textarea,
 * contenteditable, and any text-like `<input>` (search box, etc.).
 */
function isFocusInEditable(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Range/checkbox/etc. don't capture text — leave shortcuts active.
    return ['text', 'search', 'email', 'password', 'tel', 'url', 'number'].includes(type);
  }
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Match a KeyboardEvent against a binding. The platform's "command"
 * modifier is `metaKey` on macOS and `ctrlKey` everywhere else; this
 * helper accepts either so the same binding works cross-platform.
 */
function matches(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (event.key.toLowerCase() !== binding.key.toLowerCase()) return false;
  const wantsCmd = !!binding.meta;
  const hasCmd = event.metaKey || event.ctrlKey;
  if (wantsCmd !== hasCmd) return false;
  if (!!binding.alt !== event.altKey) return false;
  if (!!binding.shift !== event.shiftKey) return false;
  return true;
}

/**
 * Register a list of global keyboard shortcuts. The same combos work
 * everywhere except inside text inputs (where the user is actually
 * typing). Bindings are matched in order — the first one to match wins,
 * so put more specific combos before more general ones.
 *
 * The hook attaches a single `keydown` listener; bindings can be added
 * or removed by re-rendering with a different array.
 */
export function useGlobalShortcuts(bindings: ShortcutBinding[]): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isFocusInEditable()) return;
      for (const binding of bindings) {
        if (matches(e, binding)) {
          e.preventDefault();
          binding.onActivate();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bindings]);
}
