import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast, useToastState, __resetToastForTests } from './toast';

describe('toast registry', () => {
  beforeEach(() => {
    __resetToastForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('show() sets the current toast', () => {
    const { result } = renderHook(() => useToastState());
    expect(result.current).toBeNull();
    act(() => {
      toast.show({ message: 'Added to Liked Music' });
    });
    expect(result.current).not.toBeNull();
    expect(result.current?.message).toBe('Added to Liked Music');
  });

  it('show() returns a stable id that dismissIf can target', () => {
    const { result } = renderHook(() => useToastState());
    let id = '';
    act(() => {
      id = toast.show({ message: 'one' });
    });
    expect(result.current?.id).toBe(id);
    act(() => {
      toast.dismissIf(id);
    });
    expect(result.current).toBeNull();
  });

  it('dismissIf() is a no-op when ids do not match (toast was replaced)', () => {
    const { result } = renderHook(() => useToastState());
    let staleId = '';
    act(() => {
      staleId = toast.show({ message: 'first' });
    });
    act(() => {
      toast.show({ message: 'second' });
    });
    // The stale timer fires AFTER the second toast appeared. dismissIf
    // protects against the timer racing the replace.
    act(() => {
      toast.dismissIf(staleId);
    });
    expect(result.current?.message).toBe('second');
  });

  it('dismiss() clears any current toast', () => {
    const { result } = renderHook(() => useToastState());
    act(() => {
      toast.show({ message: 'message' });
    });
    expect(result.current).not.toBeNull();
    act(() => {
      toast.dismiss();
    });
    expect(result.current).toBeNull();
  });

  it('show() called twice replaces the prior toast (single-instance contract)', () => {
    const { result } = renderHook(() => useToastState());
    act(() => {
      toast.show({ message: 'first' });
    });
    const firstId = result.current?.id;
    act(() => {
      toast.show({ message: 'second' });
    });
    expect(result.current?.message).toBe('second');
    expect(result.current?.id).not.toBe(firstId);
  });
});
