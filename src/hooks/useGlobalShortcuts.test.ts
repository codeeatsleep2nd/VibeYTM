import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useGlobalShortcuts, type ShortcutBinding } from './useGlobalShortcuts';

afterEach(() => {
  // Reset focus to body between tests so isFocusInEditable() doesn't
  // carry state across runs.
  (document.activeElement as HTMLElement)?.blur?.();
});

const noop = () => {};

describe('useGlobalShortcuts', () => {
  it('fires the matching binding on keydown', () => {
    const onSpace = vi.fn();
    const bindings: ShortcutBinding[] = [
      { key: ' ', label: 'Toggle play', hint: 'Space', onActivate: onSpace },
    ];
    renderHook(() => useGlobalShortcuts(bindings));
    fireEvent.keyDown(window, { key: ' ' });
    expect(onSpace).toHaveBeenCalledTimes(1);
  });

  it('respects the meta modifier (Cmd / Ctrl)', () => {
    const onCmdL = vi.fn();
    renderHook(() =>
      useGlobalShortcuts([
        { key: 'l', meta: true, label: 'Toggle lyrics', hint: '⌘L', onActivate: onCmdL },
      ]),
    );
    fireEvent.keyDown(window, { key: 'l' }); // no Cmd → no fire
    expect(onCmdL).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'l', metaKey: true });
    expect(onCmdL).toHaveBeenCalledTimes(1);
    onCmdL.mockClear();
    // Ctrl is treated as Cmd on non-mac
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    expect(onCmdL).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire shortcuts while focus is in an <input type="text">', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    const onSpace = vi.fn();
    renderHook(() =>
      useGlobalShortcuts([{ key: ' ', label: 'Play', hint: 'Space', onActivate: onSpace }]),
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(onSpace).not.toHaveBeenCalled();
    input.remove();
  });

  it('does fire shortcuts while focus is in an <input type="range">', () => {
    // Range / checkbox / etc. don't capture text — shortcuts must
    // still work for keyboard users adjusting the volume slider.
    const input = document.createElement('input');
    input.type = 'range';
    document.body.appendChild(input);
    input.focus();
    const onSpace = vi.fn();
    renderHook(() =>
      useGlobalShortcuts([{ key: ' ', label: 'Play', hint: 'Space', onActivate: onSpace }]),
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(onSpace).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it('does NOT fire shortcuts while focus is in a textarea', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    const onL = vi.fn();
    renderHook(() =>
      useGlobalShortcuts([{ key: 'l', label: 'Lyrics', hint: 'L', onActivate: onL }]),
    );
    fireEvent.keyDown(window, { key: 'l' });
    expect(onL).not.toHaveBeenCalled();
    ta.remove();
  });

  it('matches in order — first binding wins', () => {
    const first = vi.fn();
    const second = vi.fn();
    renderHook(() =>
      useGlobalShortcuts([
        { key: 'q', label: 'A', hint: 'Q', onActivate: first },
        { key: 'q', label: 'B', hint: 'Q', onActivate: second },
      ]),
    );
    fireEvent.keyDown(window, { key: 'q' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('strict modifier matching: Shift+L does not trigger plain L binding', () => {
    const onL = vi.fn();
    renderHook(() =>
      useGlobalShortcuts([{ key: 'l', label: 'Lyrics', hint: 'L', onActivate: onL }]),
    );
    fireEvent.keyDown(window, { key: 'l', shiftKey: true });
    expect(onL).not.toHaveBeenCalled();
  });

  it('cleans up the listener on unmount', () => {
    const onSpace = vi.fn();
    const { unmount } = renderHook(() =>
      useGlobalShortcuts([{ key: ' ', label: 'Play', hint: 'Space', onActivate: onSpace }]),
    );
    unmount();
    fireEvent.keyDown(window, { key: ' ' });
    expect(onSpace).not.toHaveBeenCalled();
  });

  it('noop binding never throws', () => {
    expect(() => {
      renderHook(() => useGlobalShortcuts([{ key: 'x', label: '', hint: '', onActivate: noop }]));
      fireEvent.keyDown(window, { key: 'x' });
    }).not.toThrow();
  });
});
