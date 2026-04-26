import { describe, expect, it } from 'vitest';
import { MIN_HOLD_MS, decideSeekEvent, type SeekFilterState } from './seekFilter';

const TOLERANCE = 2; // seconds — matches usePlayerState's SEEK_TOLERANCE_SECS
const WINDOW = 5000; // ms — matches usePlayerState's SEEK_RECONCILE_WINDOW_MS

const makeState = (overrides: Partial<SeekFilterState> = {}): SeekFilterState => ({
  pending: false,
  lastSeekAt: 0,
  target: 0,
  ...overrides,
});

describe('decideSeekEvent', () => {
  it('accepts every event when no seek is pending', () => {
    const decision = decideSeekEvent(makeState(), 60, 1000, TOLERANCE, WINDOW);
    expect(decision).toEqual({ action: 'accept', nextPending: false });
  });

  it('drops a stale far-from-target echo while a seek is pending', () => {
    // User seeked to 180 s at t=1000; backend later emits a stale 60 s
    // (e.g. YTM hasn't moved its currentTime yet). This echo would
    // snap useSmoothedPosition backwards if it slipped through.
    const decision = decideSeekEvent(
      makeState({ pending: true, lastSeekAt: 1000, target: 180 }),
      60,
      1500,
      TOLERANCE,
      WINDOW,
    );
    expect(decision).toEqual({ action: 'drop' });
  });

  it('keeps pending for the min-hold window even after on-target sighting', () => {
    // YTM emits a near-target reading 100ms after seek — we accept the
    // value but keep `pending` so any straggler stale reading arriving
    // 200-500ms later (same bridge burst) is still filtered.
    const decision = decideSeekEvent(
      makeState({ pending: true, lastSeekAt: 1000, target: 180 }),
      181,
      1100,
      TOLERANCE,
      WINDOW,
    );
    expect(decision).toEqual({ action: 'accept', nextPending: true });
  });

  it('clears the pending flag on-target after the min-hold window has elapsed', () => {
    // Same on-target sighting, but enough time has passed since seek
    // that the bridge's post-seek burst has flushed.
    const decision = decideSeekEvent(
      makeState({ pending: true, lastSeekAt: 1000, target: 180 }),
      181,
      1000 + MIN_HOLD_MS + 100,
      TOLERANCE,
      WINDOW,
    );
    expect(decision).toEqual({ action: 'accept', nextPending: false });
  });

  it('drops a stale straggler arriving after on-target but within min-hold', () => {
    // The exact regression this layer defends against: on-target #1 at
    // t=1100 cleared the value into state; a stale 60s straggler at
    // t=1300 (still within min-hold) must be dropped, not accepted.
    const decision = decideSeekEvent(
      // seekPendingGlobal stays true thanks to the previous `accept w/
      // nextPending: true`.
      makeState({ pending: true, lastSeekAt: 1000, target: 180 }),
      60,
      1300,
      TOLERANCE,
      WINDOW,
    );
    expect(decision).toEqual({ action: 'drop' });
  });

  it('clears pending after the hard cap and accepts the event', () => {
    // 6 s past markSeek with no near-target event — give up on the
    // filter so the UI doesn't freeze.
    const decision = decideSeekEvent(
      makeState({ pending: true, lastSeekAt: 1000, target: 180 }),
      60,
      7000,
      TOLERANCE,
      WINDOW,
    );
    expect(decision).toEqual({ action: 'accept', nextPending: false });
  });

  it('keeps dropping echoes throughout the entire window, not just the first 800ms', () => {
    // Regression for the original bug — the previous 800ms hard-cap let
    // echoes slip through after ~1s, snapping the smoothed position back.
    const state = makeState({ pending: true, lastSeekAt: 0, target: 180 });
    expect(decideSeekEvent(state, 60, 100, TOLERANCE, WINDOW).action).toBe('drop');
    expect(decideSeekEvent(state, 60, 1500, TOLERANCE, WINDOW).action).toBe('drop');
    expect(decideSeekEvent(state, 60, 3000, TOLERANCE, WINDOW).action).toBe('drop');
    expect(decideSeekEvent(state, 60, 4999, TOLERANCE, WINDOW).action).toBe('drop');
    // 5000ms (== window) crosses the boundary; helper accepts.
    expect(decideSeekEvent(state, 60, 5000, TOLERANCE, WINDOW).action).toBe('accept');
  });

  it('treats far-from-target as drop even when target=0 (seek-to-start)', () => {
    // Edge case: user seeked back to 0 (start of track). Stale echo at
    // 60 should still be far from 0 and dropped.
    const decision = decideSeekEvent(
      makeState({ pending: true, lastSeekAt: 1000, target: 0 }),
      60,
      1500,
      TOLERANCE,
      WINDOW,
    );
    expect(decision).toEqual({ action: 'drop' });
  });

  it('uses the absolute distance — backward overshoot is also "near target"', () => {
    // YTM may overshoot slightly the other way during seek-back. 178
    // (target=180) is within TOLERANCE. Within min-hold so pending stays.
    const decision = decideSeekEvent(
      makeState({ pending: true, lastSeekAt: 1000, target: 180 }),
      178,
      1500,
      TOLERANCE,
      WINDOW,
    );
    expect(decision).toEqual({ action: 'accept', nextPending: true });
  });
});
