import { type FC, forwardRef, useEffect, useMemo, useRef } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { useLyrics } from '../../hooks/useLyrics';
import { useLyricsOffset } from '../../hooks/useLyricsOffset';
import { useSmoothedPosition } from '../../hooks/useSmoothedPosition';
import { useAudioCounterpartArtwork } from '../../hooks/useAudioCounterpartArtwork';
import { albumArtOrNothing } from '../../lib/artwork';
import { ArtworkPlaceholder } from '../ArtworkPlaceholder';
import type { Lyrics, LyricLine } from '../../lib/types';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';

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
  );

  const [lyricsOffsetMs, setLyricsOffsetMs, resetLyricsOffsetMs] =
    useLyricsOffset(track?.videoId);

  return (
    <div
      style={{
        position: 'fixed',
        top: 'var(--title-bar-height)',
        left: 'var(--sidebar-width)',
        right: 0,
        bottom: 'var(--player-bar-height)',
        background: 'var(--color-bg)',
        zIndex: 80,
        // Single smooth reveal: opacity + slight rise. Long enough to feel
        // intentional, short enough to not lag the UI. No staggered inner
        // animation — the whole panel moves as one unit.
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? 'translateY(0)' : 'translateY(24px)',
        transformOrigin: 'center center',
        pointerEvents: isOpen ? 'auto' : 'none',
        willChange: 'opacity, transform',
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
          'padding-right 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        overflow: 'hidden',
      }}
      aria-hidden={!isOpen}
    >
      {!track ? (
        <p
          style={{
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
        // cover slides smoothly into place instead of remounting.
        <div
          style={{
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
              // AND with `isOpen`: the parent overlay sets pointer-events
              // `none` when the page is closed, but a child that sets
              // `auto` overrides the parent. Without `isOpen` here, a
              // closed-but-LRC-still-on overlay would leak click-stealing
              // pointer-events over the new page after sidebar nav.
              pointerEvents: isOpen && showLyrics ? 'auto' : 'none',
              transition:
                'flex-basis 420ms cubic-bezier(0.22, 1, 0.36, 1), margin-left 420ms cubic-bezier(0.22, 1, 0.36, 1), padding-right 420ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                opacity: showLyrics ? 1 : 0,
                // Slide the lyric content in from the right edge so the
                // open animation matches the queue drawer's translateX
                // gesture. Closed state parks it off-screen-right.
                transform: showLyrics ? 'translateX(0)' : 'translateX(100%)',
                transition:
                  'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms cubic-bezier(0.22, 1, 0.36, 1)',
                willChange: 'transform',
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

interface LyricsPanelProps {
  status: 'idle' | 'loading' | 'available' | 'missing';
  lyrics: Lyrics | null;
  error: string | null;
  positionSecs: number;
  /** Track duration — used when no real per-line timings are available,
   *  so we can still distribute lines and auto-scroll. */
  durationSecs: number;
  /** True when the parent column is expanded on screen. A false→true
   *  transition triggers an instant snap to the currently-playing line. */
  visible: boolean;
  /** Per-track timing nudge in ms; positive = shift highlight LATER. */
  offsetMs: number;
  onAdjustOffsetMs: (next: number) => void;
  onResetOffsetMs: () => void;
}

const CONTAINER_STYLE: React.CSSProperties = {
  // flex:1 so the panel takes whatever horizontal space the split row has.
  // Capped by max-width so it doesn't drift miles from the cover on very
  // wide windows.
  flex: 1,
  maxWidth: '640px',
  minWidth: 0,
  // Fill the full content height of the overlay. The overlay reserves the
  // title-bar and player-bar on the outside; only the top space-3 padding
  // is on the inside (no bottom padding — the panel's bottom edge aligns
  // exactly with the chrome's top, per user request).
  height:
    'calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3))',
  padding: 'var(--space-6)',
  background: 'var(--color-surface-2)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 24px 60px oklch(0% 0 0 / 0.5)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const LyricsPanel: FC<LyricsPanelProps> = ({
  status,
  lyrics,
  error,
  positionSecs,
  durationSecs,
  visible,
  offsetMs,
  onAdjustOffsetMs,
  onResetOffsetMs,
}) => {
  if (status === 'loading') {
    return (
      <div
        style={{
          ...CONTAINER_STYLE,
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-tertiary)',
          gap: 'var(--space-3)',
        }}
      >
        <div
          role="status"
          aria-label="Loading lyrics"
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '3px solid var(--color-surface-3)',
            borderTopColor: 'var(--color-accent)',
            animation: 'vibeytm-spin 0.9s linear infinite',
          }}
        />
        <div style={{ fontSize: 'var(--text-sm)' }}>Loading lyrics…</div>
      </div>
    );
  }

  const text = lyrics?.text.trim() ?? '';
  const lines = lyrics?.lines ?? null;

  if (status === 'missing' || (status === 'available' && !text && (!lines || lines.length === 0))) {
    return (
      <div
        style={{
          ...CONTAINER_STYLE,
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-tertiary)',
          textAlign: 'center',
        }}
      >
        <p style={{ fontSize: 'var(--text-base)' }}>No lyrics for this track</p>
        {error && (
          <p style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>{error}</p>
        )}
      </div>
    );
  }

  // Prefer real per-line timings (YTM or LRCLIB). When they're absent we
  // synthesize evenly-spaced timings so the panel still auto-scrolls and
  // highlights — no "estimated" disclaimer shown.
  const effectiveLines: LyricLine[] =
    lines && lines.length > 0 ? lines : synthesizeLines(text, durationSecs);

  return (
    <TimedLyrics
      lines={effectiveLines}
      positionSecs={positionSecs}
      source={lyrics?.source ?? null}
      visible={visible}
      offsetMs={offsetMs}
      onAdjustOffsetMs={onAdjustOffsetMs}
      onResetOffsetMs={onResetOffsetMs}
    />
  );
};

/** Split plain text into lines and assign even timings across `durationSecs`.
 *  Used when neither YTM nor LRCLIB returned per-line timings. */
function synthesizeLines(text: string, durationSecs: number): LyricLine[] {
  const raw = text.split(/\r?\n/);
  const meaningful = raw.filter((t) => t.trim().length > 0);
  if (meaningful.length === 0 || durationSecs <= 0) {
    return raw.map((t) => ({
      text: t,
      startMs: Number.MAX_SAFE_INTEGER,
      endMs: undefined,
    }));
  }
  const perLineMs = (durationSecs * 1000) / meaningful.length;
  let cursor = 0;
  return raw.map((t) => {
    if (t.trim().length === 0) {
      return { text: t, startMs: cursor, endMs: cursor };
    }
    const start = cursor;
    const end = cursor + perLineMs;
    cursor = end;
    return { text: t, startMs: start, endMs: end };
  });
}

interface TimedLyricsProps {
  lines: LyricLine[];
  positionSecs: number;
  source: string | null;
  visible: boolean;
  offsetMs: number;
  onAdjustOffsetMs: (next: number) => void;
  onResetOffsetMs: () => void;
}

const TimedLyrics: FC<TimedLyricsProps> = ({
  lines,
  positionSecs,
  source,
  visible,
  offsetMs,
  onAdjustOffsetMs,
  onResetOffsetMs,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  // `true` once we've snapped to the current line at least once since the
  // panel became visible. Reset when `visible` flips false or the line set
  // changes so the NEXT time the panel opens we instant-jump to wherever
  // playback is instead of scrolling up from line 0.
  const hasLandedRef = useRef(false);

  // `positionSecs` is already the rAF-smoothed + offset-adjusted clock from
  // useSmoothedPosition, so we treat it as authoritative here. Subtract the
  // user's per-track nudge: positive offsetMs pushes the highlight LATER, so
  // we look up an EARLIER line for a given moment.
  const positionMs = Math.max(0, positionSecs * 1000 - offsetMs);
  const activeIndex = useMemo(() => findActiveLine(lines, positionMs), [lines, positionMs]);

  // Auto-scroll: when the active line changes OR the panel becomes visible,
  // bring the active line to the center of the scroll container. First
  // scroll per visibility-session is instant ('auto'), subsequent ones
  // animate ('smooth'). Skip entirely while hidden — scrolling a
  // display-collapsed container has no effect and would burn cycles.
  //
  // Timing: the first scroll after visible→true waits for the column's
  // 420 ms width animation to finish. During the animation, lines wrap at
  // intermediate widths so each line's height is in flux — scrolling
  // mid-anim lands on the wrong spot. Subsequent line advances scroll
  // immediately since the layout is already stable.
  useEffect(() => {
    if (!visible) return;
    if (activeIndex < 0) return;

    const doScroll = () => {
      const el = lineRefs.current[activeIndex];
      const container = containerRef.current;
      if (!el || !container) return;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (containerRect.height < 10) return;
      const offset =
        elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;
      container.scrollBy({
        top: offset,
        behavior: hasLandedRef.current ? 'smooth' : 'auto',
      });
      hasLandedRef.current = true;
    };

    // Landed already? Just scroll for the line advance.
    if (hasLandedRef.current) {
      doScroll();
      return;
    }

    // First scroll after opening: wait for the column width transition
    // so measurements reflect the final layout.
    const timer = setTimeout(doScroll, 450);
    return () => clearTimeout(timer);
  }, [visible, activeIndex]);

  // Closing the panel OR switching tracks resets the "first landing" flag
  // so the next open-or-play-next-song scroll is an instant snap.
  useEffect(() => {
    if (!visible) hasLandedRef.current = false;
  }, [visible]);
  useEffect(() => {
    hasLandedRef.current = false;
  }, [lines]);

  return (
    <div ref={containerRef} style={CONTAINER_STYLE}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {lines.map((line, i) => {
          const isActive = i === activeIndex;
          const isPast = i < activeIndex;
          const progress = isActive ? computeLineProgress(line, lines[i + 1], positionMs) : 0;
          return (
            <LyricLineView
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              text={line.text}
              isActive={isActive}
              isPast={isPast}
              progress={progress}
            />
          );
        })}
      </div>
      <div
        style={{
          marginTop: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-tertiary)',
          borderTop: '1px solid oklch(100% 0 0 / 0.06)',
          paddingTop: 'var(--space-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
          flexShrink: 0,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source ?? ''}
        </span>
        <LyricsOffsetControl
          offsetMs={offsetMs}
          onAdjust={onAdjustOffsetMs}
          onReset={onResetOffsetMs}
        />
      </div>
    </div>
  );
};

interface LyricsOffsetControlProps {
  offsetMs: number;
  onAdjust: (next: number) => void;
  onReset: () => void;
}

const OFFSET_STEP_MS = 250;

const LyricsOffsetControl: FC<LyricsOffsetControlProps> = ({
  offsetMs,
  onAdjust,
  onReset,
}) => {
  const sign = offsetMs > 0 ? '+' : offsetMs < 0 ? '−' : '';
  const display = offsetMs === 0 ? '0.00s' : `${sign}${(Math.abs(offsetMs) / 1000).toFixed(2)}s`;
  const btn: React.CSSProperties = {
    background: 'oklch(100% 0 0 / 0.06)',
    border: 'none',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-xs)',
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    lineHeight: 1.4,
  };
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        flexShrink: 0,
      }}
      title="Lyrics offset (per track). Use when the highlight is ahead of or behind the vocals."
    >
      <button
        type="button"
        aria-label="Lyrics earlier"
        onClick={() => onAdjust(offsetMs - OFFSET_STEP_MS)}
        style={btn}
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        title="Reset offset"
        style={{
          ...btn,
          minWidth: '56px',
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
          color:
            offsetMs === 0
              ? 'var(--color-text-tertiary)'
              : 'var(--color-accent)',
        }}
      >
        {display}
      </button>
      <button
        type="button"
        aria-label="Lyrics later"
        onClick={() => onAdjust(offsetMs + OFFSET_STEP_MS)}
        style={btn}
      >
        +
      </button>
    </div>
  );
};

function findActiveLine(lines: LyricLine[], positionMs: number): number {
  if (lines.length === 0 || positionMs < lines[0].startMs) {
    return -1;
  }
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lines[mid].startMs <= positionMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** Progress through the current line in [0, 1]. Uses the line's own end or
 *  the next line's start when the line has no explicit end timestamp. */
function computeLineProgress(
  line: LyricLine,
  next: LyricLine | undefined,
  positionMs: number,
): number {
  const endMs = line.endMs ?? next?.startMs;
  if (endMs === undefined || endMs <= line.startMs) {
    return 0;
  }
  const raw = (positionMs - line.startMs) / (endMs - line.startMs);
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  return raw;
}

interface LyricLineViewProps {
  text: string;
  isActive: boolean;
  isPast: boolean;
  /** 0..1 — progress through the line, only read when isActive is true. */
  progress: number;
}

/**
 * Renders one lyric line with a left-to-right karaoke wipe. Two stacked
 * copies: a dim base (always visible) and a bright overlay clipped to the
 * current progress so as playback advances, bright pixels grow out of the
 * left edge.
 */
const LyricLineView = forwardRef<HTMLDivElement, LyricLineViewProps>(
  ({ text, isActive, isPast, progress }, ref) => {
    // When active, the line's text color matches the song title
    // (var(--color-text-primary)) so the highlighted line reads at full
    // contrast against the panel background. The wipe overlay stays in the
    // same color family; progress shows via a subtle brightness jump from
    // dim-to-full opacity as each syllable is sung.
    const baseColor = isActive
      ? 'var(--color-text-primary)'
      : isPast
        ? 'var(--color-text-tertiary)'
        : 'var(--color-text-secondary)';

    return (
      <div
        ref={ref}
        style={{
          position: 'relative',
          paddingInline: '0',
          paddingBlock: isActive ? 'var(--space-2)' : 'var(--space-1)',
          fontSize: isActive ? 'var(--text-xl)' : 'var(--text-base)',
          fontWeight: isActive ? 800 : 500,
          lineHeight: 1.4,
          letterSpacing: isActive ? '-0.01em' : '0',
          // Inactive lines fade hard so the active title-colored line
          // dominates the panel.
          opacity: isActive ? 1 : isPast ? 0.35 : 0.55,
          transition:
            'font-size var(--duration-normal) var(--ease-out), font-weight var(--duration-normal) var(--ease-out), opacity var(--duration-normal) var(--ease-out), letter-spacing var(--duration-normal) var(--ease-out), border-color var(--duration-normal) var(--ease-out), padding var(--duration-normal) var(--ease-out), color var(--duration-normal) var(--ease-out)',
          userSelect: 'text',
          color: baseColor,
        }}
      >
        {/* Base layer — the real, selectable text. Dimmed by default. */}
        <span style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', transition: 'color var(--duration-normal) var(--ease-out)' }}>
          {text || ' '}
        </span>

        {/* Wipe overlay — only meaningful while this line is active. Stays
            mounted so the clip-path transition doesn't flicker on each
            activeIndex change.
            Positioned to match the BASE text's content-box edge (inset
            matches the parent's paddingBlock) so the overlay's text lines
            up pixel-for-pixel with the base — no overlap. Font properties
            (weight, size, letter-spacing, line-height, color) match the
            active base too, so the two layers wrap identically. */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: isActive ? 'var(--space-2)' : 'var(--space-1)',
            bottom: isActive ? 'var(--space-2)' : 'var(--space-1)',
            left: 0,
            right: 0,
            color: 'var(--color-text-primary)',
            fontWeight: 800,
            fontSize: 'inherit',
            lineHeight: 'inherit',
            letterSpacing: 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            pointerEvents: 'none',
            opacity: isActive ? 1 : 0,
            // clip-path inset(top right bottom left) — shrink the right edge
            // inward as progress recedes so the visible overlay grows from
            // left to right as the vocal advances.
            clipPath: isActive
              ? `inset(0 ${(1 - progress) * 100}% 0 0)`
              : 'inset(0 100% 0 0)',
            transition:
              'clip-path 250ms linear, opacity var(--duration-normal) var(--ease-out), top var(--duration-normal) var(--ease-out), bottom var(--duration-normal) var(--ease-out)',
          }}
        >
          {text || ' '}
        </span>
      </div>
    );
  },
);
LyricLineView.displayName = 'LyricLineView';
