import { type FC, type Ref, useRef, useState } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { useLyrics, invalidateLyrics } from '../../hooks/useLyrics';
import { useLyricsOffset } from '../../hooks/useLyricsOffset';
import { useSmoothedPosition } from '../../hooks/useSmoothedPosition';
import { useOverlayState } from '../../lib/overlayState';
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
  // When NowPlaying is open BENEATH this overlay, both surfaces stacking
  // their own backdrop-filter triggers issue #99's WKWebView paint
  // feedback loop. Defer the page-blur to NowPlaying in that case
  // (its blur shows through this card's translucent background); when
  // this overlay is open ALONE, it owns the page-blur itself so the
  // glass-card look is preserved on Home / Explore / Library backgrounds.
  const { nowPlayingOpen } = useOverlayState();

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

  // Glass frame (background gradient, blur, border, rounded corners,
  // shadow) lives on the SafeOverlay wrapper — same pattern QueuePanel
  // uses (src/components/player/QueuePanel/index.tsx ~line 570). Putting
  // the rounded corners on the wrapper ensures the visible blurred
  // surface itself is rounded, not just the inner content card.
  // (Issue #98 fix.)
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
        left: 'calc(var(--sidebar-effective-width, var(--sidebar-width)) + var(--space-6) + min(800px, calc((2 / 3) * (100vw - var(--sidebar-effective-width, var(--sidebar-width)) - var(--space-6) * 2)), calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) - 160px)) + var(--space-5))',
      }}
      // backdropFilter is conditional — see `nowPlayingOpen` above.
      // - NowPlaying open beneath: skip our blur; NowPlaying provides
      //   the page-blur and ours would stack, triggering issue #99.
      // - NowPlaying closed (this overlay alone): own the page-blur
      //   ourselves so the card reads as a Liquid-Glass plate on
      //   whatever page is behind (Home, Explore, etc.).
      background="linear-gradient(180deg, oklch(100% 0 0 / 0.10) 0%, oklch(100% 0 0 / 0.02) 6%, oklch(100% 0 0 / 0) 30%, oklch(0% 0 0 / 0.10) 100%), var(--glass-bg-card)"
      backdropFilter={nowPlayingOpen ? undefined : 'var(--glass-recipe)'}
      border="1px solid var(--glass-rim-mid)"
      borderRadius="var(--radius-lg)"
      boxShadow={isOpen ? 'var(--glass-plate-shadow)' : undefined}
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
