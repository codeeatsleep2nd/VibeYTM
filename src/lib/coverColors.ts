/**
 * Extract a 2-color palette from an album-cover URL for the Now Playing
 * backdrop gradient. Sampling happens off-DOM on a 24×24 canvas — small
 * enough to be cheap, large enough to give stable bucket counts.
 *
 * The canvas pixels are read by way of `fetch → blob → createImageBitmap`
 * so the same-origin issue between the webview's HTTP origin and the
 * Tauri `asset://` protocol doesn't block `getImageData`. Bitmaps from
 * blobs are always tainted-free.
 *
 * Results are cached per-URL forever — colors don't change, and every
 * cache hit avoids an `<img>` decode + canvas read.
 */

export interface CoverColors {
  /** Visually loudest color in the cover. */
  primary: string;
  /** Second loudest, picked to be visually distinct from primary. */
  secondary: string;
}

const cache = new Map<string, CoverColors>();
const inflight = new Map<string, Promise<CoverColors>>();

const SAMPLE_SIZE = 24;
// Round each channel to the top 4 bits; produces 4096 buckets — small
// enough to count quickly, large enough to distinguish "deep red" from
// "pinkish red".
const QUANTIZE_BITS = 4;
const QUANTIZE_STEP = 1 << (8 - QUANTIZE_BITS);

const NEAR_BLACK_THRESHOLD = 28;
const NEAR_WHITE_THRESHOLD = 232;
const ALPHA_OPAQUE_THRESHOLD = 200;

const FALLBACK: CoverColors = {
  primary: 'oklch(22% 0.04 270)',
  secondary: 'oklch(14% 0.02 270)',
};

interface BucketHit {
  /** Quantized 12-bit key (4 bits per RGB channel). */
  key: number;
  count: number;
  r: number;
  g: number;
  b: number;
}

/** Pull the dominant + secondary color out of a cover. Memoized per URL. */
export async function extractCoverColors(url: string): Promise<CoverColors> {
  if (!url) return FALLBACK;
  const hit = cache.get(url);
  if (hit) return hit;
  const pending = inflight.get(url);
  if (pending) return pending;

  const p = (async (): Promise<CoverColors> => {
    try {
      const colors = await runExtraction(url);
      cache.set(url, colors);
      return colors;
    } catch {
      cache.set(url, FALLBACK);
      return FALLBACK;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, p);
  return p;
}

async function runExtraction(url: string): Promise<CoverColors> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('cover fetch failed');
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: SAMPLE_SIZE,
    resizeHeight: SAMPLE_SIZE,
    resizeQuality: 'medium',
  });
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE)
        : (() => {
            const c = document.createElement('canvas');
            c.width = SAMPLE_SIZE;
            c.height = SAMPLE_SIZE;
            return c;
          })();
    const ctx = canvas.getContext('2d', {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    return pickPalette(data);
  } finally {
    bitmap.close();
  }
}

/** Visible for testing. Pure: data → 2-color palette. */
export function pickPalette(data: Uint8ClampedArray): CoverColors {
  const buckets = new Map<number, BucketHit>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < ALPHA_OPAQUE_THRESHOLD) continue;
    if (r < NEAR_BLACK_THRESHOLD && g < NEAR_BLACK_THRESHOLD && b < NEAR_BLACK_THRESHOLD) continue;
    if (r > NEAR_WHITE_THRESHOLD && g > NEAR_WHITE_THRESHOLD && b > NEAR_WHITE_THRESHOLD) continue;

    const qr = Math.floor(r / QUANTIZE_STEP);
    const qg = Math.floor(g / QUANTIZE_STEP);
    const qb = Math.floor(b / QUANTIZE_STEP);
    const key = (qr << 8) | (qg << 4) | qb;
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.r += r;
      existing.g += g;
      existing.b += b;
    } else {
      buckets.set(key, { key, count: 1, r, g, b });
    }
  }

  if (buckets.size === 0) return FALLBACK;

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const primaryHit = sorted[0];
  const secondaryHit = pickDistinct(sorted, primaryHit) ?? primaryHit;

  return {
    primary: bucketToCss(primaryHit),
    secondary: bucketToCss(secondaryHit),
  };
}

/** Pick the next bucket whose hue/luma is meaningfully different from
 *  the seed. Avoids picking "deep red" + "slightly-darker deep red" as
 *  the two colors — the gradient looks dead when both endpoints are
 *  near-identical. */
function pickDistinct(
  sorted: BucketHit[],
  seed: BucketHit,
): BucketHit | undefined {
  const seedR = seed.r / seed.count;
  const seedG = seed.g / seed.count;
  const seedB = seed.b / seed.count;
  for (let i = 1; i < sorted.length; i++) {
    const cand = sorted[i];
    const dr = cand.r / cand.count - seedR;
    const dg = cand.g / cand.count - seedG;
    const db = cand.b / cand.count - seedB;
    const distSq = dr * dr + dg * dg + db * db;
    if (distSq > 1500) return cand; // ~38 in any channel ≈ visibly different
  }
  return undefined;
}

function bucketToCss(hit: BucketHit): string {
  const r = Math.round(hit.r / hit.count);
  const g = Math.round(hit.g / hit.count);
  const b = Math.round(hit.b / hit.count);
  return `rgb(${r}, ${g}, ${b})`;
}
