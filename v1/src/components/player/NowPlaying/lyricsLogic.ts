import type { LyricLine } from '../../../lib/types';

/**
 * When YTM/LRCLIB returns plain (untimed) lyrics, distribute the lines
 * evenly across the track so the auto-scroll + highlight still tracks
 * playback. Empty lines collapse to a zero-duration marker at the
 * cursor; meaningful lines split the remaining duration uniformly.
 *
 * If the track duration is unknown or there are no meaningful lines,
 * stamp every line with `MAX_SAFE_INTEGER` so `findActiveLine` returns
 * -1 and the renderer treats them all as inactive (plain rendering).
 */
export function synthesizeLines(
  text: string,
  durationSecs: number,
): LyricLine[] {
  const raw = text.split(/\r?\n/);
  const meaningful = raw.filter((t) => t.trim().length > 0);
  if (meaningful.length === 0 || durationSecs <= 0) {
    return raw.map((t) => ({
      text: t,
      startMs: Number.MAX_SAFE_INTEGER,
      endMs: undefined,
    }));
  }
  const perLineMs = (durationSecs * 1000) / meaningful.length;
  let cursor = 0;
  return raw.map((t) => {
    if (t.trim().length === 0) {
      return { text: t, startMs: cursor, endMs: cursor };
    }
    const start = cursor;
    const end = cursor + perLineMs;
    cursor = end;
    return { text: t, startMs: start, endMs: end };
  });
}

/**
 * Binary search for the index of the line whose `startMs` is the
 * largest value `<= positionMs`. Returns -1 when `positionMs` is
 * before the first line — a state the renderer reads as "no active
 * highlight, no auto-scroll yet".
 */
export function findActiveLine(
  lines: LyricLine[],
  positionMs: number,
): number {
  if (lines.length === 0 || positionMs < lines[0].startMs) {
    return -1;
  }
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lines[mid].startMs <= positionMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** Progress through the current line in [0, 1]. Uses the line's own end or
 *  the next line's start when the line has no explicit end timestamp. */
export function computeLineProgress(
  line: LyricLine,
  next: LyricLine | undefined,
  positionMs: number,
): number {
  const endMs = line.endMs ?? next?.startMs;
  if (endMs === undefined || endMs <= line.startMs) {
    return 0;
  }
  const raw = (positionMs - line.startMs) / (endMs - line.startMs);
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  return raw;
}
