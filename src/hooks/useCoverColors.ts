import { useEffect, useState } from 'react';
import { extractCoverColors, type CoverColors } from '../lib/coverColors';

const FALLBACK: CoverColors = {
  primary: 'oklch(22% 0.04 270)',
  secondary: 'oklch(14% 0.02 270)',
};

/**
 * Resolve a 2-color palette for the given album-cover URL. Returns the
 * fallback palette while the extraction is in flight or when the URL is
 * empty. Per-URL memoization lives in the underlying lib.
 */
export function useCoverColors(url: string | undefined): CoverColors {
  const [colors, setColors] = useState<CoverColors>(FALLBACK);

  useEffect(() => {
    if (!url) {
      setColors(FALLBACK);
      return;
    }
    let cancelled = false;
    setColors(FALLBACK);
    extractCoverColors(url).then((next) => {
      if (cancelled) return;
      setColors(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return colors;
}
