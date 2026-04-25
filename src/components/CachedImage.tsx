import { type CSSProperties, type FC, useEffect, useRef, useState } from 'react';
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

// ------------- Concurrency limiter for cacheApi.fetchImage IPCs ---------
//
// On a cache-cleared cold start, the home page mounts ~150-200
// `<CachedImage>`s simultaneously. Without a limiter, each fires its
// own `cacheApi.fetchImage(url)` Tauri IPC immediately, the IPC bus
// serializes on the main thread, reqwest's connection pool gets
// saturated, and a chunk of the requests time out and resolve to
// null — leaving those images blank.
//
// Cap concurrent in-flight IPCs to a small number. Off-screen images
// also wait their turn behind on-screen ones thanks to the
// IntersectionObserver gate below, so visible content loads first
// even when 200 images compete for 6 slots.
const MAX_CONCURRENT_FETCHES = 6;
let activeFetches = 0;
const fetchQueue: Array<() => void> = [];

function acquireFetchSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeFetches < MAX_CONCURRENT_FETCHES) {
      activeFetches++;
      resolve();
    } else {
      fetchQueue.push(() => {
        activeFetches++;
        resolve();
      });
    }
  });
}

function releaseFetchSlot(): void {
  activeFetches--;
  const next = fetchQueue.shift();
  if (next) next();
}

async function resolveCached(url: string): Promise<string | null> {
  if (resolved.has(url)) {
    return resolved.get(url)!;
  }
  const existing = inflight.get(url);
  if (existing) {
    return existing;
  }
  const p = (async () => {
    await acquireFetchSlot();
    try {
      const path = await cacheApi.fetchImage(url);
      const asset = cacheApi.convertToAssetUrl(path);
      resolved.set(url, asset);
      return asset;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
      releaseFetchSlot();
    }
  })();
  inflight.set(url, p);
  return p;
}

// Reset the limiter on hot reload so a stuck slot from a previous
// module instance can't leak into the new one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeFetches = 0;
    fetchQueue.length = 0;
  });
}

// IntersectionObserver gate: defer the IPC fetch until the image is
// within ~600 px of the viewport. With 600 px of margin the image
// typically resolves and decodes before the user actually sees it,
// so progressive loading feels seamless rather than "scroll, wait,
// scroll, wait."
const VIEWPORT_PRELOAD_PX = 600;

/**
 * Image that fetches via the Rust disk cache, with two layers of
 * back-pressure to keep cache-cleared cold starts smooth:
 *
 *   1. **IntersectionObserver gate.** The fetch only starts once the
 *      placeholder is within ~600 px of the viewport. Off-screen
 *      images defer until scrolled toward, so visible content loads
 *      first.
 *   2. **Concurrency limit.** At most 6 `cacheApi.fetchImage` IPCs are
 *      in flight at any time. Excess calls queue. This stops the
 *      Tauri main-thread bridge and reqwest connection pool from
 *      saturating when many images pop into view at once.
 *
 * The component pre-decodes the image off-DOM so it appears in one
 * shot — never half-painted, never with a progressive flicker. Falls
 * back to the remote URL directly if the cache layer fails so the UI
 * never shows a broken image.
 *
 * Pass `loading="eager"` to bypass the intersection gate (the fetch
 * starts immediately on mount). Use this for above-the-fold heroes
 * where you'd rather pay the cost upfront than risk a flash.
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
  // True once the placeholder has crossed the viewport-preload margin
  // for the first time. Eager-loading callers start true.
  const [isVisible, setIsVisible] = useState(loading === 'eager');
  const placeholderRef = useRef<HTMLSpanElement | null>(null);

  // If a `src` is already resolved in the in-memory cache, skip the
  // intersection gate entirely — there's nothing to fetch, and we'd
  // rather paint immediately than wait for an observer callback. This
  // is the hot path for navigation between pages that share images.
  useEffect(() => {
    if (!src) return;
    if (resolved.has(src)) setIsVisible(true);
  }, [src]);

  // Observe the placeholder until it crosses the preload margin. Once
  // it does, flip `isVisible` permanently — even if the user scrolls
  // away, we've already kicked off the fetch and don't want to undo
  // that work.
  useEffect(() => {
    if (isVisible) return;
    const el = placeholderRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Older runtimes / SSR: degrade to eager so the user sees an
      // image at all.
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: `${VIEWPORT_PRELOAD_PX}px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!src) {
      setDisplayUrl(undefined);
      setNaturalAspect(null);
      return;
    }
    if (!isVisible) return;

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
  }, [src, isVisible]);

  if (!displayUrl) {
    // Render an empty placeholder span sized like the image. Spans
    // avoid layout-shift while still giving the IntersectionObserver
    // something to track. Inline-block keeps it from collapsing
    // inside flex/grid parents that size by `width: 100%`.
    return (
      <span
        ref={placeholderRef}
        aria-hidden
        style={{
          display: 'inline-block',
          width: typeof width === 'number' ? `${width}px` : style?.width ?? '100%',
          height: typeof height === 'number' ? `${height}px` : style?.height ?? '100%',
          background: 'transparent',
        }}
      />
    );
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
