import {
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export interface ContextMenuItem {
  /** Stable key used for React rendering and keyboard navigation. */
  id: string;
  /** Visible text. */
  label: string;
  /** Optional secondary text (e.g. "⌘P") rendered right-aligned. */
  hint?: string;
  /** When true, this item is grayed out and not selectable. */
  disabled?: boolean;
  /** When true, render as a destructive (accent-red) item. */
  destructive?: boolean;
  /** Invoked when the item is activated. The menu closes after.
   *  Receives the activation position (cursor coords AFTER any viewport
   *  flip) so morph-style items can anchor a follow-on popover at the
   *  same point. Existing items can ignore the argument. */
  onActivate: (position?: { x: number; y: number }) => void;
}

export interface ContextMenuSection {
  id: string;
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  /** Anchor coordinates in the viewport (typically `e.clientX/Y`). */
  position: { x: number; y: number };
  sections: ContextMenuSection[];
  onClose: () => void;
}

const MENU_PADDING = 4;
const MENU_MIN_WIDTH = 220;
const MENU_MAX_WIDTH = 320;
const VIEWPORT_MARGIN = 8;

/**
 * Generic right-click menu. Single primitive consumed by every surface
 * (track row, card, queue row). Encodes the standard interactions:
 *
 *   - Click outside closes
 *   - Escape closes
 *   - Hover + arrow keys move highlight; Enter activates
 *   - Position auto-flips when the menu would overflow the viewport
 *
 * Render this from the surface that detected `onContextMenu`. The
 * surface owns whether the menu is mounted at all (mount/unmount on
 * open/close); this component only handles the panel itself.
 */
export const ContextMenu: FC<ContextMenuProps> = ({
  position,
  sections,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const flatItems = sections.flatMap((s) => s.items);
  const [highlightedIdx, setHighlightedIdx] = useState<number>(() =>
    flatItems.findIndex((i) => !i.disabled),
  );
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Close on outside click. Mounted only while the menu is open so we
  // don't pay the listener cost otherwise.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const node = ref.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      onClose();
    };
    // Schedule on the next tick so the click that opened the menu
    // doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', handler, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handler, true);
    };
  }, [onClose]);

  // Close on Escape; arrow-key / enter activation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIdx((idx) => {
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          for (let step = 1; step <= flatItems.length; step++) {
            const next = (idx + dir * step + flatItems.length) % flatItems.length;
            if (!flatItems[next].disabled) return next;
          }
          return idx;
        });
        return;
      }
      if (e.key === 'Enter') {
        const item = flatItems[highlightedIdx];
        if (item && !item.disabled) {
          e.preventDefault();
          item.onActivate(adjustedPosition);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [flatItems, highlightedIdx, onClose]);

  // Reposition so the menu stays inside the viewport.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    let x = position.x;
    let y = position.y;
    const maxX = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    const maxY = window.innerHeight - rect.height - VIEWPORT_MARGIN;
    if (x > maxX) x = Math.max(VIEWPORT_MARGIN, maxX);
    if (y > maxY) y = Math.max(VIEWPORT_MARGIN, maxY);
    setAdjustedPosition({ x, y });
  }, [position]);

  let runningIdx = 0;

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        top: adjustedPosition.y,
        left: adjustedPosition.x,
        zIndex: 1000,
        minWidth: MENU_MIN_WIDTH,
        maxWidth: MENU_MAX_WIDTH,
        padding: MENU_PADDING,
        background: 'var(--glass-bg-card)',
        backdropFilter: 'var(--glass-recipe)',
        WebkitBackdropFilter: 'var(--glass-recipe)',
        border: '1px solid var(--glass-rim-mid)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 12px 40px oklch(0% 0 0 / 0.5)',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-primary)',
        userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sections.map((section, sIdx) => (
        <Section
          key={section.id}
          section={section}
          showSeparator={sIdx > 0}
          highlightedIdx={highlightedIdx}
          startIdx={(() => {
            const start = runningIdx;
            runningIdx += section.items.length;
            return start;
          })()}
          onHover={setHighlightedIdx}
          onActivate={(item) => {
            item.onActivate(adjustedPosition);
            onClose();
          }}
        />
      ))}
    </div>
  );
};

interface SectionProps {
  section: ContextMenuSection;
  showSeparator: boolean;
  highlightedIdx: number;
  startIdx: number;
  onHover: (idx: number) => void;
  onActivate: (item: ContextMenuItem) => void;
}

const Section: FC<SectionProps> = ({
  section,
  showSeparator,
  highlightedIdx,
  startIdx,
  onHover,
  onActivate,
}) => (
  <>
    {showSeparator && (
      <div
        style={{
          height: 1,
          background: 'oklch(100% 0 0 / 0.08)',
          margin: '4px 4px',
        }}
      />
    )}
    {section.items.map((item, i) => (
      <Item
        key={item.id}
        item={item}
        isHighlighted={highlightedIdx === startIdx + i}
        onHover={() => onHover(startIdx + i)}
        onActivate={() => onActivate(item)}
      />
    ))}
  </>
);

interface ItemProps {
  item: ContextMenuItem;
  isHighlighted: boolean;
  onHover: () => void;
  onActivate: () => void;
}

const Item: FC<ItemProps> = ({ item, isHighlighted, onHover, onActivate }) => {
  const handleClick = useCallback(() => {
    if (item.disabled) return;
    onActivate();
  }, [item.disabled, onActivate]);

  return (
    <button
      type="button"
      role="menuitem"
      onMouseEnter={onHover}
      onClick={handleClick}
      disabled={item.disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '6px 10px',
        gap: 'var(--space-3)',
        textAlign: 'left',
        borderRadius: 'var(--radius-sm)',
        background: isHighlighted && !item.disabled
          ? 'var(--color-surface-3)'
          : 'transparent',
        color: item.destructive
          ? 'var(--color-accent)'
          : item.disabled
            ? 'var(--color-text-tertiary)'
            : 'var(--color-text-primary)',
        cursor: item.disabled ? 'default' : 'pointer',
        opacity: item.disabled ? 0.55 : 1,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.label}
      </span>
      {item.hint && (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            flexShrink: 0,
          }}
        >
          {item.hint}
        </span>
      )}
    </button>
  );
};

interface ContextMenuTargetProps {
  /** Sections built lazily so the surface can read live state at the
   *  moment of right-click instead of at the time the JSX was built. */
  buildSections: () => ContextMenuSection[];
  children: ReactNode;
}

/**
 * Wrap any element to attach a right-click context menu. The wrapped
 * element receives the native `oncontextmenu` event; the menu opens at
 * the click coordinates. Inheritable display / pointer-events so it
 * doesn't change layout. Use this in place of bare `onContextMenu` so
 * every surface picks up the same close + nav semantics.
 */
export const ContextMenuTarget: FC<ContextMenuTargetProps> = ({
  buildSections,
  children,
}) => {
  const [openAt, setOpenAt] = useState<{ x: number; y: number } | null>(null);
  const sections = openAt ? buildSections() : [];
  return (
    <>
      <span
        style={{ display: 'contents' }}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpenAt({ x: e.clientX, y: e.clientY });
        }}
      >
        {children}
      </span>
      {openAt && sections.length > 0 && (
        <ContextMenu
          position={openAt}
          sections={sections}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  );
};
