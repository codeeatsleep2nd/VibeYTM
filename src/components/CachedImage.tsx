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
}

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
}) => {
  const [displayUrl, setDisplayUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!src) {
      setDisplayUrl(undefined);
      return;
    }

    let cancelled = false;

    // Step 1: resolve the asset URL (cache hit or fetch from remote into the
    // disk cache, then convert to an asset:// URL).
    const tryReveal = async (url: string) => {
      // Step 2: pre-decode the image off-DOM so the browser fully prepares
      // the bitmap. Only after decode() resolves do we mount the <img>.
      try {
        const probe = new Image();
        probe.src = url;
        await probe.decode();
      } catch {
        // decode() can reject for cross-origin images even when they're
        // perfectly loadable; ignore and fall through to mount anyway.
      }
      if (cancelled) return;
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

  return (
    <img
      src={displayUrl}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      style={style}
      onError={onError}
    />
  );
};
