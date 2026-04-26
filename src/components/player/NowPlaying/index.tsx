import { type FC, useState } from 'react';
import { usePlayerState } from '../../../hooks/usePlayerState';
import { invalidateLyrics, useLyrics } from '../../../hooks/useLyrics';
import { useLyricsOffset } from '../../../hooks/useLyricsOffset';
import { useSmoothedPosition } from '../../../hooks/useSmoothedPosition';
import { useAudioCounterpartArtwork } from '../../../hooks/useAudioCounterpartArtwork';
import { useCoverColors } from '../../../hooks/useCoverColors';
import { albumArtOrNothing } from '../../../lib/artwork';
import { ArtworkPlaceholder } from '../../ArtworkPlaceholder';
import { CachedImage } from '../../CachedImage';
import { MarqueeText } from '../../MarqueeText';
import { SafeOverlay, useOverlayOpen } from '../../overlay/SafeOverlay';
import { LyricsPanel } from './LyricsPanel';
import { CoverBackdrop } from './CoverBackdrop';

/** Residual constant lag added on top of rAF interpolation. Covers the
 *  fixed-ish pipeline delay (bridge poll read cycle + IPC + audio output
 *  buffering). Tuned by ear against mainstream tracks with LRCLIB timings. */
const LYRICS_CONSTANT_OFFSET_MS = 450;

interface NowPlayingProps {
  isOpen: boolean;
  /**
   * Retained in the prop contract because AppShell always passes it, but the
   * overlay has no in-panel close affordance — the cover thumbnail in
   * `NowPlayingCard` (mounted inside `PlayerChrome`) is the single source
   * of truth for opening and closing Now Playing. Kept on the API for
   * forwards-compatibility with any future close affordance + because the
   * sidebar's onNavigate handler resets every overlay flag through props.
   */
  onClose: () => void;
  /** When true, show lyrics in place of the cover centerpiece. */
  showLyrics?: boolean;
  /** When true, the queue drawer is open. Used to mirror the lyrics-open
   *  cover-shift so the cover sits in the same position whether the queue
   *  or the lyrics drawer occupies the right slot. */
  queueOpen?: boolean;
}

/**
 * Now Playing — full-page overlay that covers the main content area between
 * the sidebar and the bottom of the window (the chrome lives at the top now,
 * `--player-bar-height` is 0). Triggered by clicking the cover thumbnail
 * inside `NowPlayingCard` (in `PlayerChrome`); toggling closes it.
 *
 * When `showLyrics` is true, a lyrics drawer slides in from the right. If
 * YTM returned synced lyrics for the track, lines auto-highlight and auto-
 * scroll with playback; otherwise the plain text is shown.
 */
export const NowPlaying: FC<NowPlayingProps> = ({ isOpen, showLyrics = false, queueOpen = false }) => {
  // The right-slot drawer (queue OR lyrics) shares one cover-shift layout.
  // The cover-column sits in the split position whenever EITHER drawer is
  // open, even though only one renders content at a time.
  const splitMode = showLyrics || queueOpen;
  const { track, positionSecs, status } = usePlayerState();
  const durationSecs = track?.durationSecs ?? 0;
  // Auto-tuned position: the backend reports a fresh value every ~150 ms,
  // but rAF interpolation fills the gap so lyric highlighting tracks the
  // vocal at frame rate. A small constant offset on top covers residual
  // audio-output buffering.
  const smoothedPositionSecs = useSmoothedPosition(
    positionSecs,
    status === 'playing',
    LYRICS_CONSTANT_OFFSET_MS,
  );
  // Bumped by `handleRefreshLyrics` to force `useLyrics` to re-run its
  // fetch effect even though videoId/title/artist are unchanged. After a
  // user-triggered cache invalidation the lookup metadata is identical;
  // without this counter dep the effect is a no-op and the panel stays
  // in `loading` forever waiting for a fetch that never fires.
  const [lyricsRefetchEpoch, setLyricsRefetchEpoch] = useState(0);
  const [isRefreshingLyrics, setIsRefreshingLyrics] = useState(false);
  const { status: lyricsStatus, lyrics, error: lyricsError } = useLyrics(
    track
      ? {
          videoId: track.videoId,
          artist: track.artist,
          title: track.title,
          durationSecs: track.durationSecs,
        }
      : null,
    showLyrics && isOpen,
    true, // user-initiated — skip the track-change debounce
    lyricsRefetchEpoch,
  );

  const [lyricsOffsetMs, setLyricsOffsetMs, resetLyricsOffsetMs] =
    useLyricsOffset(track?.videoId);

  const handleRefreshLyrics = async () => {
    const videoId = track?.videoId;
    if (!videoId || isRefreshingLyrics) return;
    setIsRefreshingLyrics(true);
    try {
      await invalidateLyrics(videoId);
      setLyricsRefetchEpoch((n) => n + 1);
    } finally {
      // Brief debounce so the spinner doesn't disappear before the new
      // fetch's `loading` status takes over the panel.
      setTimeout(() => setIsRefreshingLyrics(false), 250);
    }
  };

  return (
    <SafeOverlay
      isOpen={isOpen}
      ariaLabel="Now playing"
      slideFrom="bottom"
      zIndex={80}
    >
      <NowPlayingBody
        splitMode={splitMode}
        showLyrics={showLyrics}
        track={track}
        coverSide={coverSide}
        durationSecs={durationSecs}
        smoothedPositionSecs={smoothedPositionSecs}
        lyricsStatus={lyricsStatus}
        lyrics={lyrics}
        lyricsError={lyricsError}
        lyricsOffsetMs={lyricsOffsetMs}
        setLyricsOffsetMs={setLyricsOffsetMs}
        resetLyricsOffsetMs={resetLyricsOffsetMs}
        isRefreshingLyrics={isRefreshingLyrics}
        onRefreshLyrics={handleRefreshLyrics}
      />
    </SafeOverlay>
  );
};

// Body renders inside the SafeOverlay so it can use `useOverlayOpen()`
// to gate any inner `pointer-events: auto` against the overlay's open
// state. Without that, the lyrics column would leak click-stealing
// pointer-events over the next page after sidebar nav.
interface NowPlayingBodyProps {
  splitMode: boolean;
  showLyrics: boolean;
  // The remaining props are passed through from the parent so we keep the
  // huge inner JSX block unchanged. They're typed loosely to avoid pulling
  // every internal type into the module surface; the parent owns shape.
  track: ReturnType<typeof usePlayerState>['track'];
  coverSide: string;
  durationSecs: number;
  smoothedPositionSecs: number;
  lyricsStatus: ReturnType<typeof useLyrics>['status'];
  lyrics: ReturnType<typeof useLyrics>['lyrics'];
  lyricsError: ReturnType<typeof useLyrics>['error'];
  lyricsOffsetMs: number;
  setLyricsOffsetMs: (n: number) => void;
  resetLyricsOffsetMs: () => void;
  isRefreshingLyrics: boolean;
  onRefreshLyrics: () => void;
}

const NowPlayingBody: FC<NowPlayingBodyProps> = ({
  splitMode,
  showLyrics,
  track,
  coverSide,
  durationSecs,
  smoothedPositionSecs,
  lyricsStatus,
  lyrics,
  lyricsError,
  lyricsOffsetMs,
  setLyricsOffsetMs,
  resetLyricsOffsetMs,
  isRefreshingLyrics,
  onRefreshLyrics,
}) => {
  const isOpen = useOverlayOpen();
  // Cover-tinted backdrop: extract dominant + secondary colors from the
  // current track's album art and render a soft gradient behind the
  // hero. Resolves to a deep neutral fallback while the extraction is
  // in flight or when there's no track. Memoized per URL.
  const backdropUrl = albumArtOrNothing(track?.artworkUrl);
  const coverColors = useCoverColors(backdropUrl ?? undefined);
  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        // Match the sidebar nav's top padding (var(--space-3)) so the top of
        // the cover / lyrics panel lines up with the Home button. Left padding
        // gives breathing room from the sidebar; right padding is asymmetric
        // ONLY when lyrics is showing — that lets the lyrics column extend
        // to the window edge. With lyrics closed the right padding mirrors
        // the left so `justifyContent: center` actually centers the cover.
        paddingTop: 'var(--space-3)',
        paddingLeft: 'var(--space-6)',
        paddingRight: splitMode ? 0 : 'var(--space-6)',
        // No bottom padding — the overlay's bottom edge already aligns
        // with the chrome's top (`bottom: var(--player-bar-height)`),
        // so children (cover column, lyrics panel) extend directly to
        // the chrome's top edge.
        paddingBottom: 0,
        transition:
          'padding-right 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        overflow: 'hidden',
      }}
    >
      <CoverBackdrop colors={coverColors} />
      {!track ? (
        <p
          style={{
            position: 'relative',
            zIndex: 1,
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-base)',
          }}
        >
          No track playing
        </p>
      ) : (
        // Single layout in both modes — cover/title column on the left,
        // lyrics column on the right. Toggling LRC animates the lyrics
        // column's width and opacity (plus the left-margin gap) so the
        // cover slides smoothly into place instead of remounting. The
        // `position: relative; z-index: 1` lifts this layer above the
        // CoverBackdrop's absolute fill (which has z-index: 0).
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-4)',
              flex: '0 0 auto',
              minWidth: 0,
            }}
          >
            <Cover track={track} size="split" />
            <TitleBlock
              track={track}
              width={coverSide}
              align="center"
            />
          </div>
          <div
            aria-hidden={!showLyrics}
            style={{
              // The right-slot column. Driven by `splitMode` so the cover
              // shifts whenever EITHER lyrics OR queue is open — even
              // queue-only renders an invisible spacer here so the cover
              // sits in the same position. The lyric CONTENT visibility
              // (opacity / translateX slide) is gated on `showLyrics`.
              flex: splitMode ? '1 1 0' : '0 0 0',
              width: splitMode ? 'auto' : '0',
              marginLeft: splitMode ? 'var(--space-5)' : '0',
              paddingRight: splitMode ? 'var(--space-6)' : '0',
              height: '100%',
              minWidth: 0,
              overflow: 'hidden',
              // AND with `isOpen` (read from SafeOverlay's context): the
              // parent overlay sets pointer-events `none` when closed,
              // but a child that sets `auto` overrides the parent.
              // Without the AND, a closed-but-LRC-still-on overlay
              // would leak click-stealing pointer-events over the new
              // page after sidebar nav.
              pointerEvents: isOpen && showLyrics ? 'auto' : 'none',
              transition:
                'flex-basis 420ms cubic-bezier(0.22, 1, 0.36, 1), margin-left 420ms cubic-bezier(0.22, 1, 0.36, 1), padding-right 420ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                // No `transform` on this wrapper — translate-X creates a
                // containing block that interfered with the auto-scroll
                // math (`getBoundingClientRect` / `scrollBy`) inside the
                // `LyricsPanel`'s scroll container. The column's
                // flex-basis animation above (0 → 1) already produces a
                // right-edge slide-in effect when LRC opens; opacity
                // alone is enough for the fade.
                opacity: showLyrics ? 1 : 0,
                transition: 'opacity 300ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <LyricsPanel
                status={lyricsStatus}
                lyrics={lyrics}
                error={lyricsError}
                positionSecs={smoothedPositionSecs}
                durationSecs={durationSecs}
                visible={showLyrics}
                offsetMs={lyricsOffsetMs}
                onAdjustOffsetMs={setLyricsOffsetMs}
                onResetOffsetMs={resetLyricsOffsetMs}
                onRefresh={onRefreshLyrics}
                isRefreshing={isRefreshingLyrics}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface TitleBlockProps {
  track: { title: string; artist: string; album?: string };
  /** CSS width (string) so the caller can constrain the marquee container. */
  width: string;
  align: 'center' | 'left';
}

const TitleBlock: FC<TitleBlockProps> = ({ track, width, align }) => (
  <div style={{ width, textAlign: align, minWidth: 0 }}>
    <MarqueeText
      text={track.title}
      style={{
        fontSize: 'var(--text-2xl)',
        fontWeight: 700,
        color: 'var(--color-text-primary)',
        letterSpacing: '-0.02em',
      }}
    />
    <div
      style={{
        marginTop: 'var(--space-2)',
        fontSize: 'var(--text-base)',
        color: 'var(--color-text-secondary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {track.artist}
    </div>
    {track.album && (
      <div
        style={{
          marginTop: 'var(--space-1)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-tertiary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {track.album}
      </div>
    )}
  </div>
);

interface CoverProps {
  track: { title: string; videoId?: string; artworkUrl?: string };
  /** `full`: largest square that fits the viewport.
   *  `split`: fixed medium size used alongside the lyrics panel. */
  size: 'full' | 'split';
}

  // Single square side length used in BOTH cover-only and split modes so
  // toggling the LRC button never resizes the cover. Constrained by:
  //   • the 2/3 fraction of the 1200px-capped split row (horizontal cap),
  //   • the same 2/3 of available viewport width on narrower windows,
  //   • the viewport height minus chrome + title block so the cover fits.
  const SPLIT_ROW_MAX = 1200;
  const SPLIT_COVER_FRACTION = 2 / 3;
  const coverSide = `min(${SPLIT_ROW_MAX * SPLIT_COVER_FRACTION}px, calc(${SPLIT_COVER_FRACTION} * (100vw - var(--sidebar-width) - var(--space-6) * 2)), calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) - 160px))`;

const Cover: FC<CoverProps> = ({ track, size }) => {
  void size; // kept for API compatibility; both modes now share one size
  const sideLength = coverSide;
  const counterpartArtwork = useAudioCounterpartArtwork(
    track.videoId,
    track.artworkUrl,
  );
  return (
    <div
      style={{
        width: sideLength,
        aspectRatio: '1',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--color-surface-2)',
        boxShadow: '0 24px 60px oklch(0% 0 0 / 0.5)',
        flexShrink: 0,
        // Smooth resize when the split mode toggles.
        transition: 'width var(--duration-slow) var(--ease-out)',
      }}
    >
      {(() => {
        // NEVER show a video thumbnail here. Use the audio counterpart's
        // album cover when the hook has resolved one; otherwise the
        // bridge's captured artworkUrl IF AND ONLY IF it's actually
        // album art; otherwise a placeholder. Issue #48's "letterbox
        // the music video" workaround is no longer needed because the
        // music-video frame is gone from this surface entirely.
        const url = albumArtOrNothing(counterpartArtwork ?? track.artworkUrl);
        if (!url) return <ArtworkPlaceholder size={500} />;
        return (
          <CachedImage
            src={url}
            alt={`${track.title} artwork`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        );
      })()}
    </div>
  );
};

