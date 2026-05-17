import { describe, expect, it } from 'vitest';
import { pickPalette } from './coverColors';

// pickPalette is the pure half of the cover-color extraction: given
// an RGBA pixel buffer it produces the 2-color gradient palette. The
// async wrapper handles fetch + canvas; this suite covers the only
// thing that can drift independently — bucketing/skipping logic.

function rgba(pixels: number[][]): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => {
    buf[i * 4] = p[0];
    buf[i * 4 + 1] = p[1];
    buf[i * 4 + 2] = p[2];
    buf[i * 4 + 3] = p[3] ?? 255;
  });
  return buf;
}

describe('pickPalette', () => {
  it('returns the dominant color when all pixels share one bucket', () => {
    const buf = rgba(Array.from({ length: 100 }, () => [200, 50, 50, 255]));
    const out = pickPalette(buf);
    // Average of the bucket pixels — all identical so the rgb output
    // matches input exactly.
    expect(out.primary).toBe('rgb(200, 50, 50)');
  });

  it('skips near-black pixels as background', () => {
    const buf = rgba([
      ...Array.from({ length: 50 }, () => [10, 10, 10, 255]), // near-black
      ...Array.from({ length: 30 }, () => [200, 50, 50, 255]),
    ]);
    const out = pickPalette(buf);
    expect(out.primary).toBe('rgb(200, 50, 50)');
  });

  it('skips near-white pixels too', () => {
    const buf = rgba([
      ...Array.from({ length: 50 }, () => [250, 250, 250, 255]),
      ...Array.from({ length: 30 }, () => [80, 120, 200, 255]),
    ]);
    const out = pickPalette(buf);
    expect(out.primary).toBe('rgb(80, 120, 200)');
  });

  it('skips transparent pixels', () => {
    const buf = rgba([
      ...Array.from({ length: 50 }, () => [200, 50, 50, 100]), // semi-transparent
      ...Array.from({ length: 30 }, () => [80, 120, 200, 255]),
    ]);
    const out = pickPalette(buf);
    expect(out.primary).toBe('rgb(80, 120, 200)');
  });

  it('picks a distinct secondary when one is available', () => {
    const buf = rgba([
      ...Array.from({ length: 100 }, () => [200, 50, 50, 255]), // red dominant
      ...Array.from({ length: 50 }, () => [50, 50, 200, 255]), // blue secondary (very different)
    ]);
    const out = pickPalette(buf);
    expect(out.primary).toBe('rgb(200, 50, 50)');
    expect(out.secondary).toBe('rgb(50, 50, 200)');
  });

  it('falls back to the dominant for both when no distinct second bucket exists', () => {
    // Two near-identical bucketed reds — secondary should NOT be the
    // near-twin (gradient would look dead). Falls back to primary.
    const buf = rgba([
      ...Array.from({ length: 100 }, () => [200, 50, 50, 255]),
      ...Array.from({ length: 80 }, () => [205, 55, 55, 255]),
    ]);
    const out = pickPalette(buf);
    expect(out.primary).toBe(out.secondary);
  });

  it('returns the deep fallback when every pixel is filtered out', () => {
    const buf = rgba(Array.from({ length: 50 }, () => [10, 10, 10, 255]));
    const out = pickPalette(buf);
    expect(out.primary).toMatch(/^oklch\(/);
    expect(out.secondary).toMatch(/^oklch\(/);
  });
});
