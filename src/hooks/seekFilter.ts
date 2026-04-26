// Pure logic for the POSITION_UPDATED echo filter applied inside
// `usePlayerState`. Extracted so the seek-pending / hard-cap / on-target /
// min-hold invariants can be unit-tested without booting the Tauri event
// runtime.
//
// The filter exists to defend against a class of bug that has bitten this
// codebase three times now (issues #41, #57, and the post-fix lyric-off-
// sync after progress-bar click that prompted this min-hold layer). Right
// after a manual seek, the YTM bridge fires a BURST of POSITION_UPDATED
// events as YTM's internal `<video>.currentTime` settles to the new
// position. The burst can include both:
//   • near-target readings (the seek landed)
//   • stale far-from-target readings (a delayed read that captured the
//     old position from before YTM moved)
// arriving in any order, separated by ~50–500ms. Letting any far-from-
// target reading through after an on-target sighting snapped the smoothed
// position backward and scrolled the lyric panel to the wrong line.

export interface SeekFilterState {
  /** True between markSeek() and the moment we're confident the seek
   *  has fully settled — that means: (a) we've seen a near-target
   *  reading AND (b) `MIN_HOLD_MS` has elapsed since markSeek(). */
  pending: boolean;
  /** Wall-clock ms when markSeek() last fired. */
  lastSeekAt: number;
  /** Position the user seeked to. */
  target: number;
}

export type SeekFilterDecision =
  | { action: 'accept'; nextPending: boolean }
  | { action: 'drop' };

/** Minimum window after `markSeek()` during which `pending` stays true even
 *  after a near-target event has been observed. Late stragglers (stale
 *  pre-seek readings arriving 100–500 ms after the bridge first reports
 *  the new position) are still dropped. Long enough to cover the bridge's
 *  full post-seek burst on a slow webview, short enough that follow-up
 *  user interactions aren't gated. */
export const MIN_HOLD_MS = 1500;

/**
 * Decide whether to accept or drop a POSITION_UPDATED event.
 *
 * Behaviour:
 *   • Not pending → accept everything.
 *   • Pending, far from target, within `windowMs` → drop (stale echo).
 *   • Pending, far from target, beyond `windowMs` → accept and clear
 *     pending (hard cap fail-safe so a YTM stall can't freeze the UI).
 *   • Pending, on target, before `MIN_HOLD_MS` → accept the value but
 *     KEEP pending so subsequent stragglers from the same burst stay
 *     filtered.
 *   • Pending, on target, after `MIN_HOLD_MS` → accept and clear
 *     pending (the burst has had time to flush).
 */
export function decideSeekEvent(
  state: SeekFilterState,
  positionSecs: number,
  now: number,
  toleranceSecs: number,
  windowMs: number,
): SeekFilterDecision {
  if (!state.pending) {
    return { action: 'accept', nextPending: false };
  }
  const onTarget = Math.abs(positionSecs - state.target) <= toleranceSecs;
  const elapsed = now - state.lastSeekAt;
  if (!onTarget) {
    if (elapsed < windowMs) {
      return { action: 'drop' };
    }
    // Hard cap reached without ever seeing a near-target position. Give
    // up and accept what the bridge reports so the UI doesn't freeze;
    // clear the flag so subsequent events flow normally.
    return { action: 'accept', nextPending: false };
  }
  // On target.
  if (elapsed < MIN_HOLD_MS) {
    // Within the min-hold window — accept the value but keep filtering
    // future far-from-target stragglers. Without this, a stale reading
    // 200 ms after on-target slips through and snaps state backward.
    return { action: 'accept', nextPending: true };
  }
  return { action: 'accept', nextPending: false };
}
