import { type FC, type Ref, useRef, useState } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { useLyrics, invalidateLyrics } from '../../hooks/useLyrics';
import { useLyricsOffset } from '../../hooks/useLyricsOffset';
import { useSmoothedPosition } from '../../hooks/useSmoothedPosition';
import { SafeOverlay } from '../overlay/SafeOverlay';
import { LyricsPanel } from './NowPlaying/LyricsPanel';

/** Residual constant lag added on top of rAF interpolation. Mirrors the
 *  NowPlaying value so the highlighted line is identical whether the
 *  user opened lyrics on its own or alongside the playing page. */
const LYRICS_CONSTANT_OFFSET_MS = 450;

interface LyricsOverlayProps {
  isOpen: boolean;
}

/**
 * Independent lyrics drawer. Owns the entire `useLyrics` /
 * `useLyricsOffset` / refresh cycle so opening the lyrics panel no
 * longer forces the Now Playing overlay to mount underneath. Same
 * right-side slot QueuePanel uses, so the two never coexist visually.
 */
export const LyricsOverlay: FC<LyricsOverlayProps> = ({ isOpen }) => {
  const { track, positionSecs, status } = usePlayerState();
  const durationSecs = track?.durationSecs ?? 0;

  const smoothedPositionSecs = useSmoothedPosition(
    positionSecs,
    status === 'playing',
    LYRICS_CONSTANT_OFFSET_MS,
  );

  // Bumped by `handleRefreshLyrics` to force the fetch effect to re-run
  // even though videoId/title/artist are unchanged. After a user-
  // triggered cache invalidation the lookup metadata is identical;
  // without this counter the effect is a no-op.
  const [refetchEpoch, setRefetchEpoch] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { status: lyricsStatus, lyrics, error: lyricsError } = useLyrics(
    track
      ? {
          videoId: track.videoId,
          artist: track.artist,
          title: track.title,
          durationSecs: track.durationSecs,
        }
      : null,
    isOpen,
    true,
    refetchEpoch,
  );

  const [lyricsOffsetMs, setLyricsOffsetMs, resetLyricsOffsetMs] =
    useLyricsOffset(track?.videoId);

  const handleRefreshLyrics = async () => {
    const videoId = track?.videoId;
    if (!videoId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await invalidateLyrics(videoId);
      setRefetchEpoch((n) => n + 1);
    } finally {
      setTimeout(() => setIsRefreshing(false), 250);
    }
  };

  const overlayRef = useRef<HTMLElement | null>(null);

  // Blur is scoped to the lyrics card itself (LyricsPanel's
  // CONTAINER_STYLE owns the backdrop-filter recipe) — no full-area
  // plate behind, so the rest of the page stays unblurred.
  return (
    <SafeOverlay
      ref={overlayRef as Ref<HTMLElement>}
      isOpen={isOpen}
      ariaLabel="Lyrics"
      as="aside"
      slideFrom="right"
      zIndex={85}
      // Same right-slot geometry the QueuePanel uses — both surfaces
      // share this position so they never coexist visually. The left
      // edge mirrors the NowPlaying cover-column width so when both
      // overlays are open the lyrics card sits exactly where the
      // in-NowPlaying lyrics column used to.
      inset={{
        top: 'calc(var(--title-bar-height) + var(--space-3))',
        right: 'var(--space-6)',
        bottom: 'calc(var(--player-bar-height) + var(--space-3))',
        left: 'calc(var(--sidebar-width) + var(--space-6) + min(800px, calc((2 / 3) * (100vw - var(--sidebar-width) - var(--space-6) * 2)), calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) - 160px)) + var(--space-5))',
      }}
      // Match the playing page's blur recipe — applied on the
      // SafeOverlay wrapper itself so WebKit doesn't drop the filter
      // because of the wrapper's transform-driven slide animation
      // (descendant backdrop-filter under a transformed ancestor is
      // unreliable in WKWebView). Same pattern QueuePanel uses.
      background="transparent"
      backdropFilter="blur(40px) saturate(180%)"
      display="flex"
      flexDirection="column"
    >
      <LyricsPanel
        status={lyricsStatus}
        lyrics={lyrics}
        error={lyricsError}
        positionSecs={smoothedPositionSecs}
        durationSecs={durationSecs}
        visible={isOpen}
        offsetMs={lyricsOffsetMs}
        onAdjustOffsetMs={setLyricsOffsetMs}
        onResetOffsetMs={resetLyricsOffsetMs}
        onRefresh={handleRefreshLyrics}
        isRefreshing={isRefreshing}
      />
    </SafeOverlay>
  );
};
