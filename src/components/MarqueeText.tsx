import { type CSSProperties, type FC, useRef, useState } from 'react';

interface MarqueeTextProps {
  text: string;
  /** Style applied to the visible viewport (the box that stays put). */
  style?: CSSProperties;
  /** Pixels per second the text slides across the viewport. */
  speedPxPerSec?: number;
  /**
   * If true, the marquee always animates on mount/text change. Default
   * `false` — animation only fires while the parent is hovered. The hover
   * is detected on the viewport itself unless `external` is provided.
   */
  hovered?: boolean;
}

const DEFAULT_SPEED = 40;

/**
 * Text that, when its content overflows the viewport horizontally, slides
 * leftward on hover until the last glyph is flush with the right edge of
 * the viewport. Stops automatically once everything has been displayed.
 *
 * Behaviour:
 *  - Idle: classic single-line ellipsis truncation.
 *  - Hover (or `hovered=true`): drops the ellipsis, expands the inner span
 *    to its real text width, and translates it left by the overflow amount.
 *  - Mouse-leave: smoothly returns to translateX(0) and the ellipsis form.
 *
 * Only the text element (an `inline-block` span) is translated — the
 * surrounding viewport stays put.
 */
export const MarqueeText: FC<MarqueeTextProps> = ({
  text,
  style,
  speedPxPerSec = DEFAULT_SPEED,
  hovered: hoveredProp,
}) => {
  const [internalHover, setInternalHover] = useState(false);
  const [offset, setOffset] = useState(0);
  const [duration, setDuration] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  const hovered = hoveredProp ?? internalHover;

  const startMarquee = () => {
    const el = ref.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow > 0) {
      setOffset(-overflow);
      setDuration(overflow / speedPxPerSec);
    }
  };

  const stopMarquee = () => {
    setOffset(0);
  };

  const onEnter = () => {
    if (hoveredProp === undefined) setInternalHover(true);
    startMarquee();
  };
  const onLeave = () => {
    if (hoveredProp === undefined) setInternalHover(false);
    stopMarquee();
  };

  // External-hover mode: react to changes in `hoveredProp`.
  if (hoveredProp !== undefined) {
    if (hovered && offset === 0) startMarquee();
    if (!hovered && offset !== 0) stopMarquee();
  }

  return (
    <div
      onMouseEnter={hoveredProp === undefined ? onEnter : undefined}
      onMouseLeave={hoveredProp === undefined ? onLeave : undefined}
      style={{
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: offset < 0 ? 'clip' : 'ellipsis',
        ...style,
      }}
    >
      <span
        ref={ref}
        style={{
          display: 'inline-block',
          maxWidth: offset < 0 ? 'none' : '100%',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: offset < 0 ? 'clip' : 'ellipsis',
          verticalAlign: 'top',
          transform: `translateX(${offset}px)`,
          transition:
            offset < 0
              ? `transform ${duration}s linear`
              : 'transform var(--duration-normal) var(--ease-out)',
        }}
      >
        {text}
      </span>
    </div>
  );
};
