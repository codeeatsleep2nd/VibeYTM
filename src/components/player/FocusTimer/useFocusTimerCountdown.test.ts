import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFocusTimerCountdown } from './useFocusTimerCountdown';

describe('useFocusTimerCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in idle with the seeded duration', () => {
    const { result } = renderHook(() =>
      useFocusTimerCountdown({ initialDurationSecs: 60 }),
    );
    expect(result.current.state).toBe('idle');
    expect(result.current.totalSecs).toBe(60);
    expect(result.current.remainingSecs).toBe(60);
  });

  it('start latches running; second start is a no-op', () => {
    const { result } = renderHook(() =>
      useFocusTimerCountdown({ initialDurationSecs: 60 }),
    );
    act(() => {
      result.current.start();
    });
    expect(result.current.state).toBe('running');
    // Calling start again must not reset remaining or restart anything.
    act(() => {
      vi.advanceTimersByTime(2_000);
      result.current.start();
    });
    expect(result.current.state).toBe('running');
    expect(result.current.remainingSecs).toBe(58);
  });

  it('ticks down at 1Hz and fires onComplete exactly once on hitting 0', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useFocusTimerCountdown({ initialDurationSecs: 3, onComplete }),
    );
    act(() => {
      result.current.start();
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.remainingSecs).toBe(2);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.state).toBe('done');
    expect(result.current.remainingSecs).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // No further ticks once done.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('reset returns to idle with totalSecs preserved', () => {
    const { result } = renderHook(() =>
      useFocusTimerCountdown({ initialDurationSecs: 120 }),
    );
    act(() => {
      result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.remainingSecs).toBe(90);

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.totalSecs).toBe(120);
    expect(result.current.remainingSecs).toBe(120);
  });

  it('setDuration is a no-op while running', () => {
    const { result } = renderHook(() =>
      useFocusTimerCountdown({ initialDurationSecs: 60 }),
    );
    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.setDuration(180);
    });
    expect(result.current.state).toBe('running');
    expect(result.current.totalSecs).toBe(60);
  });

  it('setDuration from done transitions back to idle with the new duration', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useFocusTimerCountdown({ initialDurationSecs: 3, onComplete }),
    );
    act(() => {
      result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.state).toBe('done');

    act(() => {
      result.current.setDuration(45);
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.totalSecs).toBe(45);
    expect(result.current.remainingSecs).toBe(45);

    // Latch is reset — a second running session fires onComplete again.
    act(() => {
      result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('reset reads the latest totalSecs (no stale closure)', () => {
    const { result } = renderHook(() =>
      useFocusTimerCountdown({ initialDurationSecs: 60 }),
    );
    // Bump duration, then reset — reset must restore to the new total,
    // not the original seed.
    act(() => {
      result.current.setDuration(300);
    });
    act(() => {
      result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.remainingSecs).toBe(290);

    act(() => {
      result.current.reset();
    });
    expect(result.current.remainingSecs).toBe(300);
  });
});
