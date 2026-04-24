import { type FC, forwardRef, useEffect, useMemo, useRef } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { useLyrics } from '../../hooks/useLyrics';
import { useSmoothedPosition } from '../../hooks/useSmoothedPosition';
import type { Lyrics, LyricLine } from '../../lib/types';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';

/** Residual constant lag added on top of rAF interpolation. Covers the
 *  fixed-ish pipeline delay (bridge poll read cycle + IPC + audio output
 *  buffering). Tuned by ear against mainstream tracks with LRCLIB timings. */
const LYRICS_CONSTANT_OFFSET_MS = 450;

interface NowPlayingProps {
  isOpen: boolean;
  onClose: () => void;
  /** When true, show lyrics in place of the cover centerpiece. */
  showLyrics?: boolean;
}

/**
 * Now Playing — full-page overlay that covers the main content area (between
 * the sidebar and the player bar). Triggered by clicking the cover thumbnail
 * in the PlayerBar; toggling closes it.
 *
 * When `showLyrics` is true, the cover is swapped out for a lyrics panel.
 * If YTM returned synced lyrics for the track, lines auto-highlight and
 * auto-scroll with playback; otherwise the plain text is shown.
 */
export const NowPlaying: FC<NowPlayingProps> = ({ isOpen, onClose, showLyrics = false }) => {
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
        transition:
          'opacity 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        // Match the sidebar nav's top padding (var(--space-3)) so the top of
        // the cover / lyrics panel lines up with the Home button. Horizontal
        // padding kept at space-6 to give content breathing room.
        paddingTop: 'var(--space-3)',
        paddingInline: 'var(--space-6)',
        paddingBottom: 'var(--space-6)',
        overflow: 'hidden',
      }}
      aria-hidden={!isOpen}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close now playing"
        style={{
          position: 'absolute',
          top: 'var(--space-4)',
          right: 'var(--space-5)',
          background: 'none',
          border: 'none',
          color: 'var(--color-text-tertiary)',
          fontSize: 'var(--text-xl)',
          cursor: 'pointer',
          padding: 'var(--space-2)',
          borderRadius: 'var(--radius-sm)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--color-text-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--color-text-tertiary)';
        }}
      >
        ✕
      </button>

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
            width: 'min(1200px, 100%)',
            marginInline: 'auto',
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
              // Animated in/out. Width collapses to 0 when closed, gap
              // lives here as marginLeft so it collapses with the column.
              width: showLyrics ? `calc(${coverSide} / 2)` : '0',
              marginLeft: showLyrics ? 'var(--space-5)' : '0',
              opacity: showLyrics ? 1 : 0,
              height: '100%',
              minWidth: 0,
              overflow: 'hidden',
              pointerEvents: showLyrics ? 'auto' : 'none',
              transition:
                'width 420ms cubic-bezier(0.22, 1, 0.36, 1), margin-left 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <LyricsPanel
              status={lyricsStatus}
              lyrics={lyrics}
              error={lyricsError}
              positionSecs={smoothedPositionSecs}
              durationSecs={durationSecs}
              visible={showLyrics}
            />
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
  const coverSide = `min(${SPLIT_ROW_MAX * SPLIT_COVER_FRACTION}px, calc(${SPLIT_COVER_FRACTION} * (100vw - var(--sidebar-width) - var(--space-6) * 2)), calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) - var(--space-6) - 160px))`;

const Cover: FC<CoverProps> = ({ track, size }) => {
  void size; // kept for API compatibility; both modes now share one size
  const sideLength = coverSide;
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
      <CachedImage
        src={
          track.artworkUrl ||
          (track.videoId ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg` : undefined)
        }
        alt={`${track.title} artwork`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
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
}

const CONTAINER_STYLE: React.CSSProperties = {
  // flex:1 so the panel takes whatever horizontal space the split row has.
  // Capped by max-width so it doesn't drift miles from the cover on very
  // wide windows.
  flex: 1,
  maxWidth: '640px',
  minWidth: 0,
  // Fill the full content height of the overlay. The overlay itself already
  // reserves the title-bar and player-bar on the outside via its top/bottom,
  // and its own top/bottom padding (space-3 + space-6) — so the panel just
  // stretches between those.
  height:
    'calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) - var(--space-6))',
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
}) => {
  if (status === 'loading') {
    return (
      <div
        style={{
          ...CONTAINER_STYLE,
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-tertiary)',
        }}
      >
        Loading lyrics…
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
}

const TimedLyrics: FC<TimedLyricsProps> = ({ lines, positionSecs, source, visible }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  // `true` once we've snapped to the current line at least once since the
  // panel became visible. Reset when `visible` flips false or the line set
  // changes so the NEXT time the panel opens we instant-jump to wherever
  // playback is instead of scrolling up from line 0.
  const hasLandedRef = useRef(false);

  // `positionSecs` is already the rAF-smoothed + offset-adjusted clock from
  // useSmoothedPosition, so we treat it as authoritative here.
  const positionMs = Math.max(0, positionSecs * 1000);
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
      {source && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            borderTop: '1px solid oklch(100% 0 0 / 0.06)',
            paddingTop: 'var(--space-2)',
          }}
        >
          {source}
        </div>
      )}
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
        <span style={{ transition: 'color var(--duration-normal) var(--ease-out)' }}>
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
