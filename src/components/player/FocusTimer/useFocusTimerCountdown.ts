import { useCallback, useEffect, useRef, useState } from 'react';

export type FocusTimerState = 'idle' | 'running' | 'done';

export interface FocusTimerOptions {
  initialDurationSecs?: number;
  onComplete?: () => void;
}

export interface UseFocusTimerCountdown {
  state: FocusTimerState;
  totalSecs: number;
  remainingSecs: number;
  /** Picks a new duration while idle. No-op while running/done. */
  setDuration: (secs: number) => void;
  /** Latches state -> 'running' and starts the tick. No-op unless idle. */
  start: () => void;
  /** Returns to idle with totalSecs preserved as the slider value. */
  reset: () => void;
}

/**
 * 1Hz countdown driver for the focus timer overlay. Pure logic — owns
 * its own setInterval, fires `onComplete` exactly once on the
 * running -> done transition. The hook does NOT speak to any IPC; the
 * notification fire is the consumer's job.
 */
export function useFocusTimerCountdown(
  opts?: FocusTimerOptions,
): UseFocusTimerCountdown {
  const initial = opts?.initialDurationSecs ?? 25 * 60;
  const [state, setState] = useState<FocusTimerState>('idle');
  const [totalSecs, setTotalSecs] = useState(initial);
  const [remainingSecs, setRemainingSecs] = useState(initial);

  // Keep onComplete in a ref so changing the callback identity doesn't
  // restart the tick — we only want to depend on `state` for that.
  const onCompleteRef = useRef(opts?.onComplete);
  onCompleteRef.current = opts?.onComplete;
  // Latch: ensures `onComplete` fires exactly once per running→done
  // transition. React StrictMode in dev re-runs setState updaters and
  // effects twice to surface impurity bugs — without this latch the
  // notification IPC fires twice and macOS dedupes them, leading to
  // zero visible banners.
  const completedRef = useRef(false);

  useEffect(() => {
    if (state === 'idle') {
      completedRef.current = false;
    }
  }, [state]);

  useEffect(() => {
    if (state !== 'running') return;
    const id = window.setInterval(() => {
      setRemainingSecs((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          // Defer the state transition + onComplete to a separate
          // effect (below) so they don't run twice under StrictMode's
          // updater-double-invocation contract.
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (state === 'running' && remainingSecs === 0 && !completedRef.current) {
      completedRef.current = true;
      setState('done');
      onCompleteRef.current?.();
    }
  }, [state, remainingSecs]);

  const setDuration = useCallback((secs: number) => {
    setState((s) => {
      // Refuse mid-run; running sessions only honour reset().
      if (s === 'running') return s;
      setTotalSecs(secs);
      setRemainingSecs(secs);
      // done → idle transition lets the user "pick a new duration to
      // start over" by interacting with the slider on the Done view.
      // Reset the completion latch so the next run will fire onComplete.
      completedRef.current = false;
      return 'idle';
    });
  }, []);

  const start = useCallback(() => {
    setState((s) => (s === 'idle' ? 'running' : s));
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setRemainingSecs(totalSecs);
  }, [totalSecs]);

  return {
    state,
    totalSecs,
    remainingSecs,
    setDuration,
    start,
    reset,
  };
}
