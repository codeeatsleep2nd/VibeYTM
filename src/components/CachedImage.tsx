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
   * Opt-in: when true, if the source image is non-square (e.g. a 16:9
   * YouTube video thumbnail) and the caller asked for `objectFit:
   * cover`, swap to `objectFit: contain` so the full image is visible
   * inside the square frame instead of being aggressively cropped.
   *
   * **Default is FALSE.** Letterboxing a 16:9 thumbnail inside a small
   * square (queue rows, song rows, album cards) produces a thin sliver
   * with dead bars top/bottom that reads as "broken thumbnail" — Apple
   * Music / Spotify / YTM itself all center-crop their small thumbs.
   * The now-playing hero cover is the only place where letterboxing
   * is the right call (issue #48); that single caller opts in.
   *
   * If you flip this default again, EVERY thumbnail across the app
   * regresses to rectangle — see `src/components/CachedImage.test.tsx`
   * for the locked-in contract.
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
  autoFitForAspect = false,
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

  // Auto-fit is opt-in (`autoFitForAspect={true}`). When the caller asked
  // for `objectFit: cover` AND the source is decidedly non-square
  // (e.g. a 16:9 YouTube video thumbnail), swap to `objectFit: contain`
  // so the full image is visible inside the square frame instead of
  // being aggressively cropped — the original complaint in issue #48.
  //
  // The default is FALSE: thumbnails (queue rows, song rows, album
  // cards, player-bar art) keep `cover` and center-crop, which is how
  // every other music client renders small artwork. Only the now-
  // playing hero cover opts in.
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
