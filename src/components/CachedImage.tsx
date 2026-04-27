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

/**
 * Image routed through the `vibeytm-cache://` custom URI scheme. The
 * webview fetches it natively from the protocol handler in
 * `src-tauri/src/protocols/cache_image.rs`, which serves bytes from the
 * same on-disk cache the older `cache_fetch_image` IPC fed. Eliminates
 * the JS↔Rust IPC + `convertFileSrc` round trip on every image, plus
 * the hand-rolled 6-slot concurrency limiter — the webview's own
 * `<img>` loader handles concurrency.
 *
 * Pre-decode kept: we still call `img.decode()` off-DOM before mounting
 * the visible `<img>` so the image appears in one shot rather than
 * progressively.
 *
 * Safety regression notes (kept verbatim from prior implementation):
 *   - DO NOT add an IntersectionObserver gate in front of the `<img>`.
 *     Earlier attempt used a `<span>` placeholder which interfered with
 *     `<button>` AlbumCard click hit-testing in this Tauri WKWebView
 *     build (cards regressed unclickable). Native lazy-loading via
 *     `loading="lazy"` is enough back-pressure.
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
    const cacheUrl = cacheApi.buildCacheUrl(src);

    // Pre-decode off-DOM so the visible `<img>` mounts only after the
    // bitmap is ready — no progressive flicker. decode() may reject
    // for cross-origin images even when they're loadable; reveal in
    // that case anyway.
    const probe = new Image();
    probe.src = cacheUrl;
    let aspect: number | null = null;
    probe
      .decode()
      .then(() => {
        if (cancelled) return;
        if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
          aspect = probe.naturalWidth / probe.naturalHeight;
        }
        setNaturalAspect(aspect);
        setDisplayUrl(cacheUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setNaturalAspect(null);
        setDisplayUrl(cacheUrl);
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
