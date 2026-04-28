import {
  type CSSProperties,
  type FC,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { Lyrics, LyricLine } from '../../../lib/types';
import {
  computeLineProgress,
  findActiveLine,
  synthesizeLines,
} from './lyricsLogic';
import { hasChinese, romanizeChinese } from '../../../lib/romanize';

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
  /** Invoked by the bottom-bar Refresh affordance — invalidates both the
   *  FE and Rust lyric caches for the current track and re-fetches. */
  onRefresh: () => void;
  /** True while a refresh is in flight, so the button can render a
   *  spinner / disable itself. */
  isRefreshing: boolean;
}

const CONTAINER_STYLE: CSSProperties = {
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
  // Bottom edge matches the QueuePanel's bottom edge: sit
  // `var(--space-3)` above the player chrome's top so the rounded
  // bottom corners are visible (without this gap the panel ends
  // flush with the chrome's top edge).
  height:
    'calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) * 2)',
  padding: 'var(--space-6)',
  // Liquid Glass card tier — translucent surface so the cover-tinted
  // backdrop and ambient page colour bleed through. Backdrop-filter
  // on a fixed-position parent (NowPlaying overlay) so this nested
  // panel inherits the chrome plate's blur context.
  background:
    'linear-gradient(180deg, oklch(100% 0 0 / 0.10) 0%, oklch(100% 0 0 / 0.02) 6%, oklch(100% 0 0 / 0) 30%, oklch(0% 0 0 / 0.10) 100%), var(--glass-bg-card)',
  backdropFilter:
    'blur(var(--glass-blur)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness))',
  WebkitBackdropFilter:
    'blur(var(--glass-blur)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness))',
  border: '1px solid var(--glass-rim-mid)',
  borderRadius: 'var(--radius-lg)',
  boxShadow:
    'inset 0 1px 0 var(--glass-rim-bright), 0 24px 60px oklch(0% 0 0 / 0.5)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

export const LyricsPanel: FC<LyricsPanelProps> = ({
  status,
  lyrics,
  error,
  positionSecs,
  durationSecs,
  visible,
  offsetMs,
  onAdjustOffsetMs,
  onResetOffsetMs,
  onRefresh,
  isRefreshing,
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
        <RefreshLyricsButton onClick={onRefresh} isRefreshing={isRefreshing} />
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
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
    />
  );
};

interface RefreshLyricsButtonProps {
  onClick: () => void;
  isRefreshing: boolean;
}

/** Small text button used in the lyric panel's bottom row. Clears both
 *  caches for the current track and triggers a fresh fetch — the only
 *  user-facing escape hatch when the matcher returned wrong lyrics in an
 *  earlier session and they got pinned in the persistent caches. */
const RefreshLyricsButton: FC<RefreshLyricsButtonProps> = ({ onClick, isRefreshing }) => {
  // Issue #95 — align with the offset −/0/+ buttons in the sticky
  // bottom row: same padding (`2px 8px`), same `--radius-sm`, same
  // `--text-xs` font size, same translucent white background. Without
  // this the refresh pill (with its `--radius-full` border + larger
  // padding + extra `marginTop`) sat lower and looked like a bigger,
  // visually-distinct control next to the offset cluster.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isRefreshing}
      title="Re-fetch lyrics for this track (clears the cached match)"
      style={{
        background: 'oklch(100% 0 0 / 0.06)',
        border: 'none',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--text-xs)',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        cursor: isRefreshing ? 'progress' : 'pointer',
        opacity: isRefreshing ? 0.6 : 1,
        lineHeight: 1.4,
        transition:
          'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out)',
      }}
    >
      {isRefreshing ? 'Refreshing…' : 'Refresh'}
    </button>
  );
};

interface TimedLyricsProps {
  lines: LyricLine[];
  positionSecs: number;
  source: string | null;
  visible: boolean;
  offsetMs: number;
  onAdjustOffsetMs: (next: number) => void;
  onResetOffsetMs: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const TimedLyrics: FC<TimedLyricsProps> = ({
  lines,
  positionSecs,
  source,
  visible,
  offsetMs,
  onAdjustOffsetMs,
  onResetOffsetMs,
  onRefresh,
  isRefreshing,
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
      {/*
        Sticky-bottom control row (issue #66). The container is
        `overflowY: auto`, so without `position: sticky` this row
        scrolled out of view exactly when the user wanted to nudge
        the offset while listening. Sticking it to the visible
        bottom keeps it reachable; the translucent gradient + blur
        shrouds any lyric line that scrolls underneath so the
        controls stay legible. Bottom inset matches the container's
        `var(--space-6)` padding so the row sits on the panel's
        natural bottom edge instead of touching the rounded border.
      */}
      <div
        style={{
          position: 'sticky',
          bottom: 'calc(var(--space-6) * -1)',
          marginTop: 'var(--space-3)',
          marginBottom: 'calc(var(--space-6) * -1)',
          marginInline: 'calc(var(--space-6) * -1)',
          padding: 'var(--space-3) var(--space-6) var(--space-4)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-tertiary)',
          borderTop: '1px solid oklch(100% 0 0 / 0.06)',
          // Frosted-glass hood so lyric lines underneath read as a
          // soft blur rather than fighting the controls for focus.
          background:
            'linear-gradient(180deg, oklch(0% 0 0 / 0) 0%, oklch(0% 0 0 / 0.45) 70%, oklch(0% 0 0 / 0.55) 100%)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
          flexShrink: 0,
          zIndex: 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source ?? ''}
        </span>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexShrink: 0,
          }}
        >
          <LyricsOffsetControl
            offsetMs={offsetMs}
            onAdjust={onAdjustOffsetMs}
            onReset={onResetOffsetMs}
          />
          <RefreshLyricsButton onClick={onRefresh} isRefreshing={isRefreshing} />
        </div>
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

    // Inline pinyin under any line containing Han ideographs, in a
    // muted secondary tone. Sits below the original text — never
    // replaces it, never participates in the karaoke wipe — purely a
    // reading aid for non-readers of hanzi.
    const pinyinSubline = hasChinese(text) ? romanizeChinese(text) : null;

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
        {pinyinSubline && (
          <span
            aria-hidden
            style={{
              display: 'block',
              marginTop: '2px',
              fontSize: isActive ? 'var(--text-sm)' : 'var(--text-xs)',
              fontWeight: 400,
              letterSpacing: '0.02em',
              color: 'var(--color-text-tertiary)',
              opacity: 0.85,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              transition: 'font-size var(--duration-normal) var(--ease-out)',
            }}
          >
            {pinyinSubline}
          </span>
        )}

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
