import { useEffect, type DependencyList } from 'react';

/**
 * Standard settle window after a YTM track change. The bridge's audio
 * webview navigates on every Next/Prev/auto-advance, hanging in-flight
 * `fetch()` calls inside it for ~3-15 s. Background reads
 * (`get_upcoming_tracks`, `get_lyrics`, lyric+cover preload) that fire
 * during that window stack on the bridge channel and starve user-driven
 * IPCs (`get_playlist`, `search`) that the user is clicking right then.
 *
 * Documented in CLAUDE.md → "Background fetches need a settle delay
 * after track change". Use `useDeferredEffect` instead of hand-coding a
 * `setTimeout(..., 1500)` everywhere — there are otherwise three+ copies
 * of this pattern in the tree and each one drifts independently.
 */
// 2000 ms is the safe upper bound documented in CLAUDE.md (the
// "1.5-2 s" range). Using the high end avoids the "JS fetch error:
// Load failed" race that lyrics probing previously encountered at the
// 1500-1700 ms boundary on slower track changes.
export const BRIDGE_SETTLE_MS = 2000;

interface UseDeferredEffectOptions {
  /**
   * Skip the settle window entirely. Use ONLY when the call is
   * user-initiated (button click, panel open) and timing is more
   * important than channel hygiene — for example a freshly-opened
   * lyrics panel that the user wants to populate immediately.
   */
  immediate?: boolean;
}

/**
 * Same shape as `useEffect`, but fires the body after `delayMs` (default
 * `BRIDGE_SETTLE_MS`) instead of synchronously after layout. Cancels the
 * pending fire if deps change again before it lands; runs the cleanup
 * returned by the body on dep change AND on unmount.
 *
 * Designed for background fetches that must yield to the YTM bridge
 * during track-change navigation. Don't use for user-facing interactions
 * — use `immediate: true` if the call is user-initiated.
 */
export function useDeferredEffect(
  fn: () => void | (() => void),
  deps: DependencyList,
  delayMs: number = BRIDGE_SETTLE_MS,
  options: UseDeferredEffectOptions = {},
): void {
  const { immediate = false } = options;

  useEffect(() => {
    let cancelled = false;
    let cleanup: void | (() => void);

    const run = () => {
      if (cancelled) return;
      cleanup = fn();
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (immediate) {
      run();
    } else {
      timer = setTimeout(run, delayMs);
    }

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      if (typeof cleanup === 'function') cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
