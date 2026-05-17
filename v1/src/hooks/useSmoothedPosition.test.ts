import { describe, expect, it } from 'vitest';
import { computeSyncSnap } from './useSmoothedPosition';

const OFFSET_MS = 450;

describe('computeSyncSnap', () => {
  it('returns noop when positionSecs is unchanged', () => {
    expect(computeSyncSnap(60, 60, OFFSET_MS)).toEqual({ kind: 'noop' });
  });

  it('snaps backward when positionSecs jumps down (track change to start)', () => {
    // Most common case: TRACK_CHANGED resets positionSecs to 0. Without
    // this synchronous snap, one frame would render the new track's
    // lyrics against the OLD position and auto-scroll to a stale line.
    const decision = computeSyncSnap(0, 180, OFFSET_MS);
    expect(decision).toEqual({
      kind: 'snap',
      value: 0 + OFFSET_MS / 1000,
      lastSeen: 0,
    });
  });

  it('snaps backward on a smaller backward jump (seek-back)', () => {
    const decision = computeSyncSnap(45, 180, OFFSET_MS);
    expect(decision).toEqual({
      kind: 'snap',
      value: 45 + OFFSET_MS / 1000,
      lastSeen: 45,
    });
  });

  it('only bumps lastSeen on a forward jump (seek-forward, normal playback)', () => {
    // Forward jump: the rAF re-base in useEffect will drive `value` from
    // the new baseline; we must NOT touch `value` here — otherwise the
    // freshly-interpolated position from the previous tick would be
    // overwritten with a stale snapshot.
    expect(computeSyncSnap(180, 60, OFFSET_MS)).toEqual({
      kind: 'bump-last-seen',
      lastSeen: 180,
    });
  });

  it('treats a 1ms forward delta as bump-last-seen, not noop', () => {
    expect(computeSyncSnap(60.001, 60, OFFSET_MS)).toEqual({
      kind: 'bump-last-seen',
      lastSeen: 60.001,
    });
  });

  it('respects the constant offset on backward snap', () => {
    // The constant offset is the lyric-vs-audio buffer compensation
    // (LYRICS_CONSTANT_OFFSET_MS in NowPlaying); a snap must add it so
    // the freshly-displayed position matches what the rAF tick will
    // produce on the very next frame.
    expect(computeSyncSnap(0, 180, 1000)).toEqual({
      kind: 'snap',
      value: 1.0,
      lastSeen: 0,
    });
  });

  it('handles a backward snap with a zero offset cleanly', () => {
    expect(computeSyncSnap(0, 180, 0)).toEqual({
      kind: 'snap',
      value: 0,
      lastSeen: 0,
    });
  });

  it('handles fractional positions on either side', () => {
    expect(computeSyncSnap(59.7, 60.3, OFFSET_MS)).toEqual({
      kind: 'snap',
      value: 59.7 + OFFSET_MS / 1000,
      lastSeen: 59.7,
    });
  });
});
