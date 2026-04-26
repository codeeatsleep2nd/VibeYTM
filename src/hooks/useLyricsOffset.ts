import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'vibeytm:lyrics-offset:';
const MAX_ABS_MS = 10_000;

const storageKey = (videoId: string): string => `${STORAGE_PREFIX}${videoId}`;

function readOffset(videoId: string): number {
  if (!videoId) return 0;
  try {
    const raw = localStorage.getItem(storageKey(videoId));
    if (!raw) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-MAX_ABS_MS, Math.min(MAX_ABS_MS, Math.round(n)));
  } catch {
    return 0;
  }
}

function writeOffset(videoId: string, offsetMs: number): void {
  if (!videoId) return;
  try {
    if (offsetMs === 0) {
      localStorage.removeItem(storageKey(videoId));
    } else {
      localStorage.setItem(storageKey(videoId), String(offsetMs));
    }
  } catch {
    // Storage may be unavailable in private mode; treat as best-effort.
  }
}

/**
 * Per-track lyrics-timing offset, persisted in localStorage. Positive values
 * shift the highlight LATER in the song (use when lyrics appear too early);
 * negative values shift EARLIER (use when lyrics lag the vocals).
 *
 * Applied at the consumer side: `effectivePositionMs = positionMs - offsetMs`
 * before line lookup.
 */
export function useLyricsOffset(
  videoId: string | undefined | null,
): [number, (next: number) => void, () => void] {
  const id = videoId ?? '';
  const [offsetMs, setOffsetMsState] = useState(() => readOffset(id));

  useEffect(() => {
    setOffsetMsState(readOffset(id));
  }, [id]);

  const setOffsetMs = useCallback(
    (next: number) => {
      const clamped = Math.max(
        -MAX_ABS_MS,
        Math.min(MAX_ABS_MS, Math.round(next)),
      );
      setOffsetMsState(clamped);
      writeOffset(id, clamped);
    },
    [id],
  );

  const reset = useCallback(() => {
    setOffsetMsState(0);
    writeOffset(id, 0);
  }, [id]);

  return [offsetMs, setOffsetMs, reset];
}
