import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeferredEffect, BRIDGE_SETTLE_MS } from './useBridgeSafeFetch';

// useDeferredEffect is the consolidated replacement for the three
// hand-coded `setTimeout(..., 1500-2000)` sites that worked around YTM's
// post-track-change webview-navigation stall (CLAUDE.md "Background
// fetches need a settle delay after track change"). The hook handles:
//   1. Defers the effect body by BRIDGE_SETTLE_MS after deps change.
//   2. Cancels any pending fire if deps change again before it lands.
//   3. Runs the effect's returned cleanup on unmount AND on dep change.
//
// Failing tests here mean a regression in the very class of stalls the
// wrapper was built to eliminate.

describe('useDeferredEffect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire the effect synchronously', () => {
    const fn = vi.fn();
    renderHook(() => useDeferredEffect(fn, []));
    expect(fn).not.toHaveBeenCalled();
  });

  it('fires after the default settle window', () => {
    const fn = vi.fn();
    renderHook(() => useDeferredEffect(fn, []));
    vi.advanceTimersByTime(BRIDGE_SETTLE_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exposes the documented BRIDGE_SETTLE_MS value (2000 ms)', () => {
    expect(BRIDGE_SETTLE_MS).toBe(2000);
  });

  it('honors a custom delay', () => {
    const fn = vi.fn();
    renderHook(() => useDeferredEffect(fn, [], 500));
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending fire when deps change', () => {
    const fn = vi.fn();
    let trigger = 0;
    const { rerender } = renderHook(() => useDeferredEffect(fn, [trigger]));
    vi.advanceTimersByTime(1000);
    trigger = 1;
    rerender();
    vi.advanceTimersByTime(BRIDGE_SETTLE_MS - 1000 - 1); // would have fired the original
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BRIDGE_SETTLE_MS); // BRIDGE_SETTLE_MS from rerender → fires
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending fire when unmounted before it lands', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useDeferredEffect(fn, []));
    vi.advanceTimersByTime(1000);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs the cleanup returned by the effect on dep change', () => {
    const cleanup = vi.fn();
    const fn = vi.fn(() => cleanup);
    let trigger = 0;
    const { rerender } = renderHook(() => useDeferredEffect(fn, [trigger]));
    vi.advanceTimersByTime(BRIDGE_SETTLE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    trigger = 1;
    rerender();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs the cleanup returned by the effect on unmount', () => {
    const cleanup = vi.fn();
    const { unmount } = renderHook(() => useDeferredEffect(() => cleanup, []));
    vi.advanceTimersByTime(BRIDGE_SETTLE_MS);
    expect(cleanup).not.toHaveBeenCalled();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('immediate=true bypasses the settle window and fires synchronously after mount', () => {
    const fn = vi.fn();
    renderHook(() => useDeferredEffect(fn, [], 1500, { immediate: true }));
    // Still asynchronous through React's effect schedule, but no setTimeout
    // delay — all pending micro/macrotasks flush within zero ms.
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
