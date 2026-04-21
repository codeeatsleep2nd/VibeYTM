import { type CSSProperties, type FC, useEffect, useState } from 'react';
import { cacheApi } from '../lib/ipc';

interface CachedImageProps {
  src: string | undefined;
  alt: string;
  width?: number;
  height?: number;
  style?: CSSProperties;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  loading?: 'lazy' | 'eager';
  /**
   * When true (default for `objectFit: cover` style), if the source image is
   * non-square (e.g. a 16:9 video thumbnail), swap the fit to `contain` so
   * the full image is visible instead of aggressively cropped (issue #48).
   * Pass `false` to preserve the exact style you set.
   */
  autoFitForAspect?: boolean;
}

// Heuristic: treat anything more than ~5% off from 1:1 as "non-square" and
// switch to contain. Square album art served by YTM is always exactly 1:1, so
// this only kicks in for genuinely rectangular sources.
const SQUARE_TOLERANCE = 0.05;

// In-memory map: remote URL -> local asset URL (survives re-renders)
const inflight = new Map<string, Promise<string | null>>();
const resolved = new Map<string, string>();

async function resolveCached(url: string): Promise<string | null> {
  if (resolved.has(url)) {
    return resolved.get(url)!;
  }
  const existing = inflight.get(url);
  if (existing) {
    return existing;
  }
  const p = (async () => {
    try {
      const path = await cacheApi.fetchImage(url);
      const asset = cacheApi.convertToAssetUrl(path);
      resolved.set(url, asset);
      return asset;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

/**
 * Image that fetches via the Rust disk cache. Pre-decodes the image off the
 * main render so it appears in one shot — never half-painted, never with a
 * progressive flicker. Falls back to the remote URL directly if the cache
 * layer fails so the UI never shows a broken image.
 */
export const CachedImage: FC<CachedImageProps> = ({
  src,
  alt,
  width,
  height,
  style,
  onError,
  loading = 'lazy',
  autoFitForAspect = true,
}) => {
  const [displayUrl, setDisplayUrl] = useState<string | undefined>(undefined);
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!src) {
      setDisplayUrl(undefined);
      setNaturalAspect(null);
      return;
    }

    let cancelled = false;

    // Step 1: resolve the asset URL (cache hit or fetch from remote into the
    // disk cache, then convert to an asset:// URL).
    const tryReveal = async (url: string) => {
      // Step 2: pre-decode the image off-DOM so the browser fully prepares
      // the bitmap. Only after decode() resolves do we mount the <img>.
      const probe = new Image();
      probe.src = url;
      let aspect: number | null = null;
      try {
        await probe.decode();
        if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
          aspect = probe.naturalWidth / probe.naturalHeight;
        }
      } catch {
        // decode() can reject for cross-origin images even when they're
        // perfectly loadable; ignore and fall through to mount anyway.
      }
      if (cancelled) return;
      setNaturalAspect(aspect);
      setDisplayUrl(url);
    };

    const cached = resolved.get(src);
    if (cached) {
      void tryReveal(cached);
      return;
    }

    resolveCached(src).then((asset) => {
      if (cancelled) return;
      void tryReveal(asset ?? src);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!displayUrl) {
    return null;
  }

  // When the caller requested `objectFit: cover` but the source is decidedly
  // non-square (video thumbnails, typically ~16:9), switch to `contain` so the
  // whole image is visible inside the square frame instead of being aggressively
  // cropped — the exact complaint in issue #48.
  const effectiveStyle: CSSProperties = (() => {
    if (!autoFitForAspect || !style || style.objectFit !== 'cover') return style ?? {};
    if (naturalAspect === null) return style;
    if (Math.abs(naturalAspect - 1) <= SQUARE_TOLERANCE) return style;
    return { ...style, objectFit: 'contain' };
  })();

  return (
    <img
      src={displayUrl}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      style={effectiveStyle}
      onError={onError}
    />
  );
};
