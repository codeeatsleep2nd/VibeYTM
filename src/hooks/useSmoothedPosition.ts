import { useEffect, useRef, useState } from 'react';

// A backward jump larger than this is a real discontinuity — a track
// change (positionSecs resets to 0) or a user seek-back. A SMALLER
// backward step is sample jitter: the backend position only advances
// ~1×/sec because YouTube's `getCurrentTime()` steps in ~1.0 s
// increments (verified at runtime — constant fractional part, +1.0 per
// emit). A freshly-arrived sample therefore routinely lands a few tens
// of ms BEHIND where the rAF interpolation has already extrapolated to.
// Snapping `value` backward for that jitter is the progress-bar flicker
// / lyric-desync bug. The threshold sits comfortably above the ~1 s
// sample interval so genuine seeks still snap.
export const BACKWARD_SNAP_THRESHOLD_SECS = 1.5;

/** Decision returned by {@link computeSyncSnap}. Three outcomes:
 *  - `noop`: nothing to do this render.
 *  - `bump-last-seen`: forward progress OR small backward jitter — record
 *    the new baseline but leave `value` alone; the rAF re-base in the
 *    effect drives it smoothly from here without a visible hitch.
 *  - `snap`: a LARGE backward jump (track change, seek-back) — reset both
 *    `value` and `lastSeen` to the new baseline synchronously, otherwise
 *    one frame would render the new track's lyrics with the old position
 *    and auto-scroll to a random mid-track line. */
export type SyncSnapDecision =
  | { kind: 'noop' }
  | { kind: 'bump-last-seen'; lastSeen: number }
  | { kind: 'snap'; value: number; lastSeen: number };

/** Pure form of the synchronous snap rule applied during render — see the
 *  `useSmoothedPosition` body below. Lifted out so the rule can be unit-
 *  tested without mounting the hook.
 *
 *  Only a backward jump LARGER than {@link BACKWARD_SNAP_THRESHOLD_SECS}
 *  is a real discontinuity worth snapping. A smaller backward step is
 *  1 Hz sample jitter and is treated like forward progress (`bump-last-
 *  seen`) so the rAF interpolation can absorb it instead of hitching the
 *  displayed value backward. */
export function computeSyncSnap(
  positionSecs: number,
  lastSeenPositionSecs: number,
  constantOffsetMs: number,
): SyncSnapDecision {
  const backwardJump = lastSeenPositionSecs - positionSecs;
  if (backwardJump > BACKWARD_SNAP_THRESHOLD_SECS) {
    return {
      kind: 'snap',
      value: positionSecs + constantOffsetMs / 1000,
      lastSeen: positionSecs,
    };
  }
  if (positionSecs !== lastSeenPositionSecs) {
    return { kind: 'bump-last-seen', lastSeen: positionSecs };
  }
  return { kind: 'noop' };
}

/**
 * Interpolate playback position between backend POSITION_UPDATED events
 * using `requestAnimationFrame`, so the progress bar and lyric highlight
 * advance smoothly at ~60 fps instead of stepping once per second when a
 * new backend sample arrives.
 *
 * The backend only produces a fresh position ~1×/sec (YouTube's
 * `getCurrentTime()` steps in ~1.0 s increments). Each sample arrives a
 * few tens of ms after the rAF clock has already extrapolated past it.
 * The rule that keeps the output smooth AND monotonic:
 *
 *   - Backend AT or AHEAD of the displayed value → re-base to the
 *     backend (normal forward progress / catch-up).
 *   - Backend slightly BEHIND the displayed value (< threshold) → it's
 *     jitter. Hold the displayed value and keep counting; the gap stays
 *     bounded at ~one sample latency because the next sample reconverges.
 *   - Backend FAR behind (> threshold) → real seek-back / track change →
 *     snap to the backend value.
 *
 * `constantOffsetMs` is an optional fixed forward-shift that compensates
 * for residual pipeline lag (poll cycle + audio output buffering).
 */
export function useSmoothedPosition(
  positionSecs: number,
  isPlaying: boolean,
  constantOffsetMs = 0,
): number {
  const offset = constantOffsetMs / 1000;
  const [value, setValue] = useState(positionSecs + offset);
  // The most recent value the rAF tick (or a re-base) actually rendered.
  // The effect reads this to decide whether an incoming backend sample is
  // ahead of, behind, or far behind the displayed clock.
  const valueRef = useRef(positionSecs + offset);

  // Synchronous snap for LARGE backward jumps (track change / seek-back).
  // Done in the render body — not the effect — so the panel never paints
  // one frame with the new track's lyrics against the old position.
  const [lastSeenPositionSecs, setLastSeenPositionSecs] = useState(positionSecs);
  const decision = computeSyncSnap(positionSecs, lastSeenPositionSecs, constantOffsetMs);
  if (decision.kind === 'snap') {
    setLastSeenPositionSecs(decision.lastSeen);
    setValue(decision.value);
  } else if (decision.kind === 'bump-last-seen') {
    setLastSeenPositionSecs(decision.lastSeen);
  }

  useEffect(() => {
    const target = positionSecs + offset;
    const current = valueRef.current;

    // Re-base the interpolation clock without ever hitching backward for
    // jitter. `current` is what the rAF last rendered; `target` is the
    // fresh backend sample.
    let baselineValue: number;
    if (current - target > BACKWARD_SNAP_THRESHOLD_SECS) {
      // Far behind the display — real seek-back / track change. Honor it.
      baselineValue = target;
    } else {
      // Backend ahead → catch up; backend slightly behind → hold the
      // displayed value (absorb the jitter).
      baselineValue = Math.max(target, current);
    }
    const baselineAt = performance.now();

    if (!isPlaying) {
      // Paused: nothing to interpolate — show the backend value exactly.
      valueRef.current = target;
      setValue(target);
      return;
    }

    let raf = 0;
    const tick = () => {
      const elapsedSecs = (performance.now() - baselineAt) / 1000;
      const v = baselineValue + elapsedSecs;
      valueRef.current = v;
      setValue(v);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [positionSecs, isPlaying, offset]);

  return value;
}
