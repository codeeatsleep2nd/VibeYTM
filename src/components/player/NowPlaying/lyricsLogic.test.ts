import { describe, expect, it } from 'vitest';
import {
  computeLineProgress,
  findActiveLine,
  synthesizeLines,
} from './lyricsLogic';

// Pure helpers backing the lyric panel's auto-scroll + highlight + line-
// progress animation. These three carry the entire timing model when
// real per-line timings are absent (LRCLIB miss / synthesis fallback) or
// when the active-line cursor needs to advance after a seek. Each one
// has its own subtle edge case; tests pin them down.

describe('synthesizeLines', () => {
  it('returns one line per source row, distributed evenly across duration', () => {
    const out = synthesizeLines('a\nb\nc\nd', 40);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ text: 'a', startMs: 0, endMs: 10000 });
    expect(out[1]).toEqual({ text: 'b', startMs: 10000, endMs: 20000 });
    expect(out[3]).toEqual({ text: 'd', startMs: 30000, endMs: 40000 });
  });

  it('keeps blank lines as zero-duration markers at the cursor', () => {
    const out = synthesizeLines('a\n\nb', 20);
    expect(out[0]).toMatchObject({ text: 'a', startMs: 0 });
    expect(out[1]).toMatchObject({ text: '', startMs: 10000, endMs: 10000 });
    expect(out[2]).toMatchObject({ text: 'b', startMs: 10000 });
  });

  it('stamps every line MAX_SAFE_INTEGER when duration is 0', () => {
    const out = synthesizeLines('a\nb', 0);
    expect(out.every((l) => l.startMs === Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('stamps every line MAX_SAFE_INTEGER when there are no meaningful lines', () => {
    const out = synthesizeLines('\n\n', 60);
    expect(out.every((l) => l.startMs === Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});

describe('findActiveLine', () => {
  const lines = [
    { text: 'a', startMs: 0 },
    { text: 'b', startMs: 1000 },
    { text: 'c', startMs: 2500 },
    { text: 'd', startMs: 5000 },
  ];

  it('returns -1 when position is before the first line', () => {
    expect(
      findActiveLine([{ text: 'x', startMs: 1000 }], 0),
    ).toBe(-1);
  });

  it('returns -1 for empty lines array', () => {
    expect(findActiveLine([], 1000)).toBe(-1);
  });

  it('returns 0 when position exactly hits the first line', () => {
    expect(findActiveLine(lines, 0)).toBe(0);
  });

  it('returns the largest index whose startMs <= position', () => {
    expect(findActiveLine(lines, 999)).toBe(0);
    expect(findActiveLine(lines, 1000)).toBe(1);
    expect(findActiveLine(lines, 2499)).toBe(1);
    expect(findActiveLine(lines, 2500)).toBe(2);
    expect(findActiveLine(lines, 4999)).toBe(2);
    expect(findActiveLine(lines, 5000)).toBe(3);
    expect(findActiveLine(lines, 99999)).toBe(3);
  });
});

describe('computeLineProgress', () => {
  const line = { text: 'a', startMs: 1000, endMs: 3000 };
  const next = { text: 'b', startMs: 3000 };

  it('uses the line own endMs', () => {
    expect(computeLineProgress(line, next, 2000)).toBeCloseTo(0.5);
  });

  it('falls back to the next line start when no endMs', () => {
    const lineNoEnd = { text: 'a', startMs: 1000 };
    expect(computeLineProgress(lineNoEnd, next, 2000)).toBeCloseTo(0.5);
  });

  it('returns 0 when there is no end and no next', () => {
    expect(computeLineProgress({ text: 'a', startMs: 1000 }, undefined, 2000)).toBe(0);
  });

  it('clamps below 0 and above 1', () => {
    expect(computeLineProgress(line, next, 500)).toBe(0);
    expect(computeLineProgress(line, next, 9999)).toBe(1);
  });

  it('returns 0 when endMs <= startMs (degenerate line)', () => {
    expect(computeLineProgress({ text: 'a', startMs: 1000, endMs: 1000 }, next, 1500)).toBe(0);
  });
});
