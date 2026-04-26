import { useEffect, useState } from 'react';

/** Decision returned by {@link computeSyncSnap}. Three outcomes:
 *  - `noop`: nothing to do this render.
 *  - `bump-last-seen`: forward jump — record the new baseline but leave
 *    `value` alone; the rAF re-base will drive it forward from here.
 *  - `snap`: backward jump (track change, seek-back, etc.) — reset both
 *    `value` and `lastSeen` to the new baseline synchronously, otherwise
 *    one frame would render the new track's lyrics with the old position
 *    and auto-scroll to a random mid-track line. */
export type SyncSnapDecision =
  | { kind: 'noop' }
  | { kind: 'bump-last-seen'; lastSeen: number }
  | { kind: 'snap'; value: number; lastSeen: number };

/** Pure form of the synchronous snap rule applied during render — see the
 *  `useSmoothedPosition` body below. Lifted out so the rule can be unit-
 *  tested without mounting the hook. */
export function computeSyncSnap(
  positionSecs: number,
  lastSeenPositionSecs: number,
  constantOffsetMs: number,
): SyncSnapDecision {
  if (positionSecs < lastSeenPositionSecs) {
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
 * using `requestAnimationFrame`, so lyric highlighting advances smoothly
 * at ~60 fps instead of stepping every ~150 ms when a new backend sample
 * arrives.
 *
 * How it auto-tunes: every time `positionSecs` lands, we reset the
 * baseline to (that value, wall-clock now). While playing, rAF ticks
 * update the returned value to `baseline.pos + (now - baseline.at)`. Since
 * we re-base on every backend update, small clock skew can't drift.
 *
 * `constantOffsetMs` is an optional fixed forward-shift that compensates
 * for residual pipeline lag (poll cycle + audio output buffering). It
 * defaults to 0 — the rAF interpolation alone often gets within a vocal
 * syllable.
 */
export function useSmoothedPosition(
  positionSecs: number,
  isPlaying: boolean,
  constantOffsetMs = 0,
): number {
  const [value, setValue] = useState(positionSecs + constantOffsetMs / 1000);
  // Track the last positionSecs we saw during render. When positionSecs
  // jumps BACKWARD (e.g. usePlayerState resets it to 0 on TRACK_CHANGED
  // for a Next/Prev click), snap the returned value to the new
  // baseline SYNCHRONOUSLY during this render — don't wait for the
  // useEffect below. Without this snap, the lyrics panel renders one
  // frame with the new track's lyrics but the OLD playback position,
  // which auto-scrolls to a random mid-track line before the effect
  // re-bases on the next tick.
  const [lastSeenPositionSecs, setLastSeenPositionSecs] = useState(positionSecs);
  const decision = computeSyncSnap(positionSecs, lastSeenPositionSecs, constantOffsetMs);
  if (decision.kind === 'snap') {
    setLastSeenPositionSecs(decision.lastSeen);
    setValue(decision.value);
  } else if (decision.kind === 'bump-last-seen') {
    setLastSeenPositionSecs(decision.lastSeen);
  }

  useEffect(() => {
    // Snapshot the backend reading and the instant we saw it. Everything
    // else in this effect derives from these two numbers, so rAF ticks
    // can't drift relative to real time.
    const baselinePos = positionSecs;
    const baselineAt = performance.now();

    if (!isPlaying) {
      setValue(baselinePos + constantOffsetMs / 1000);
      return;
    }

    let raf = 0;
    const tick = () => {
      const elapsedSecs = (performance.now() - baselineAt) / 1000;
      setValue(baselinePos + elapsedSecs + constantOffsetMs / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [positionSecs, isPlaying, constantOffsetMs]);

  return value;
}
