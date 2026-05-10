import {
  type FC,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { CoverColors } from '../lib/coverColors';
import { useOverlayState } from '../lib/overlayState';
import { CachedImage } from './CachedImage';

export interface DetailPageHeroSaveProps {
  isSaved: boolean;
  /** True when the saving target is an album (drives the label between
   *  "Save to Albums" vs "Save to Playlists"). */
  isAlbum: boolean;
  /** True when the saving target is a podcast/show — flips the label
   *  to "Subscribe" / "Unsubscribe" instead of "Save". */
  isShow?: boolean;
  isSaving: boolean;
  onToggle: () => void;
  /** Optional error string surfaced under the action row when the most
   *  recent save / remove call failed. */
  error?: string | null;
}

interface DetailPageHeroProps {
  /** Big title line. Truncated with ellipsis if it overflows. */
  title: string;
  /** Small uppercase label above the title — "Album", "Playlist",
   *  "Artist". Drives reader expectation; not styled differently per kind. */
  kind: string;
  /** Cover URL. Empty string renders a neutral surface placeholder. */
  coverUrl: string;
  /**
   * Two-color palette used to drive the gradient backdrop. Pass the
   * result of `useCoverColors(coverUrl)` so the hero feels color-tied
   * to the album art. Defaults are deep neutrals if the extraction
   * hasn't completed yet.
   */
  colors: CoverColors;
  /** Artist / creator subtitle rendered between title and meta. Bigger
   *  and more prominent than the meta line — Apple-Music style. Skipped
   *  when omitted (e.g. ArtistPage where the title IS the artist). */
  artist?: string;
  /** "12 songs · 42 min" or similar. Optional — artist pages skip it. */
  meta?: string;
  /** Free-form text rendered below the meta line in tertiary color. */
  description?: string;
  /** Top-left back button. Always present. */
  onBack: () => void;
  /** Primary action — accent-filled "Play" pill on the right. */
  onPlay: () => void;
  /** Optional "Shuffle" secondary action. Hidden when omitted (e.g. a
   *  single-track context where shuffle is meaningless). */
  onShuffle?: () => void;
  /** Save / unsave from library. Omit entirely when the surface has no
   *  library notion (e.g. ArtistPage). */
  save?: DetailPageHeroSaveProps;
  /** Optional extra nodes rendered after the action row. */
  extra?: ReactNode;
  /**
   * When true, render with a transparent background instead of the
   * cover-tinted radial gradient. Used by sticky-hero parents that
   * want their own backdrop-filter blur to show scrolled content
   * through the hero (see ArtistPage).
   */
  transparent?: boolean;
}

/**
 * Color-extracted detail-page hero. Cover art on the left, kind +
 * title + meta + description on the right, a primary Play / optional
 * Shuffle / optional Save row underneath. The whole header sits over
 * a soft two-color radial gradient driven by `colors` so the page
 * picks up the album art's mood the moment it paints.
 *
 * Pure presentational. The consumer page owns all data fetching,
 * save state, autoplay branching, etc. — pass plain props down.
 *
 * Hit-test safety: no `transform: scale(...)` anywhere on the
 * wrapper or its children — that creates a stacking context this
 * Tauri WKWebView build mishandles for hit-testing (see
 * SafeOverlay.test.tsx contracts). Locked in by a contract test.
 */
export const DetailPageHero: FC<DetailPageHeroProps> = ({
  title,
  kind,
  coverUrl,
  colors,
  artist,
  meta,
  description,
  onBack,
  onPlay,
  onShuffle,
  save,
  extra,
  transparent = false,
}) => {
  const { nowPlayingOpen, focusTimerOpen } = useOverlayState();
  const hideBackButton = nowPlayingOpen || focusTimerOpen;

  // Memoize the gradient so re-renders driven by frequent player events
  // (track-change, position update) don't recompute the string. Same
  // colors → same string, no React work.
  const backdrop = useMemo(
    () =>
      `radial-gradient(70% 80% at 0% 0%, ${withAlpha(colors.primary, 0.55)} 0%, transparent 70%),` +
      `radial-gradient(80% 90% at 100% 100%, ${withAlpha(colors.secondary, 0.5)} 0%, transparent 75%),` +
      `linear-gradient(180deg, transparent 60%, var(--color-bg) 100%)`,
    [colors.primary, colors.secondary],
  );

  return (
    <header
      style={{
        position: 'relative',
        // paddingTop matches the sidebar Home button's y
        // (title-bar-height + space-3 = 50) so the cover image (first
        // in-flow child now that the back button is position: fixed)
        // sits at the same y as the Home button. paddingBottom hugs
        // the cover/title block so the track list sits directly below
        // the hero with no extra gap.
        padding: 'calc(var(--title-bar-height) + var(--space-3)) var(--space-6) var(--space-3)',
        background: transparent ? 'transparent' : backdrop,
        // Smooth color transition when colors prop updates after async
        // palette extraction settles.
        transition: 'background 700ms var(--ease-out)',
      }}
    >
      {!hideBackButton && createPortal(
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          // Marker for the global CSS rule that hides this button while
          // the Now Playing overlay is open (see styles/global.css).
          // Belt-and-suspenders: the React condition above is the
          // primary guard; the CSS rule is a backup for any edge case
          // where the context isn't reachable.
          data-detail-back-button=""
          style={{
            // Portaled to document.body so the button shares the body
            // stacking context with the title-bar drag region (z 200)
            // — it can then sit above with `zIndex: 250`. Inside the
            // page tree, the button would be trapped in `<main>`'s
            // ancestor stacking context (capped below the drag
            // region's z), which is why a plain `position: fixed`
            // alone wasn't enough. Also flagged `no-drag` so macOS
            // WKWebView returns clicks to it instead of treating the
            // y-band as a window-drag handle.
            position: 'fixed',
            top: 'var(--space-2)',
            // Tracks `--sidebar-effective-width` so the back button slides
            // left in lockstep with the sidebar collapse.
            left:
              'calc(var(--sidebar-effective-width, var(--sidebar-width)) + var(--space-6))',
            transition: 'left var(--duration-slow) var(--ease-out)',
            zIndex: 250,
            // @ts-expect-error -- non-standard WebKit property for Tauri window dragging
            WebkitAppRegion: 'no-drag',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-full)',
            background: 'oklch(0% 0 0 / 0.35)',
            color: 'var(--color-text-primary)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--text-base)',
          }}
        >
          ←
        </button>,
        document.body,
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '208px 1fr',
          gap: 'var(--space-5)',
          alignItems: 'flex-end',
        }}
      >
        <div
          style={{
            width: 208,
            height: 208,
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            background: 'var(--color-surface-2)',
            boxShadow: '0 24px 60px oklch(0% 0 0 / 0.5)',
            flexShrink: 0,
          }}
        >
          {coverUrl && (
            <CachedImage
              src={coverUrl}
              alt={title}
              width={208}
              height={208}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </div>

        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {kind}
          </div>
          <h1
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
              margin: 0,
              lineHeight: 1.15,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </h1>
          {artist && (
            <div
              style={{
                fontSize: 'var(--text-base)',
                fontWeight: 600,
                color: 'var(--color-accent)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {artist}
            </div>
          )}
          {meta && (
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {meta}
            </div>
          )}
          {description && <ExpandableDescription text={description} />}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
              marginTop: 'var(--space-2)',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={onPlay}
              aria-label="Play"
              style={{
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                padding: 'var(--space-2) var(--space-5)',
                color: 'oklch(100% 0 0)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}
            >
              {'▶'} Play
            </button>
            {onShuffle && (
              <button
                type="button"
                onClick={onShuffle}
                aria-label="Shuffle"
                style={{
                  background: 'oklch(100% 0 0 / 0.08)',
                  border: '1px solid oklch(100% 0 0 / 0.16)',
                  borderRadius: 'var(--radius-full)',
                  padding: 'var(--space-2) var(--space-4)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                {'⇋'} Shuffle
              </button>
            )}
            {save && (
              <button
                type="button"
                onClick={save.onToggle}
                disabled={save.isSaving}
                aria-pressed={save.isSaved}
                aria-label={
                  save.isShow
                    ? save.isSaved
                      ? 'Unsubscribe from show'
                      : 'Subscribe to show'
                    : save.isSaved
                      ? 'Remove from library'
                      : 'Save to library'
                }
                style={{
                  background: 'transparent',
                  border: '1px solid oklch(100% 0 0 / 0.16)',
                  borderRadius: 'var(--radius-full)',
                  padding: 'var(--space-2) var(--space-4)',
                  color: save.isSaved
                    ? 'var(--color-accent)'
                    : 'var(--color-text-primary)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  cursor: save.isSaving ? 'progress' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  opacity: save.isSaving ? 0.7 : 1,
                }}
              >
                {save.isShow
                  ? save.isSaved
                    ? '✓ Unsubscribe'
                    : '+ Subscribe'
                  : save.isSaved
                    ? '✓ Remove from Library'
                    : `+ Save to ${save.isAlbum ? 'Albums' : 'Playlists'}`}
              </button>
            )}
          </div>
          {save?.error && (
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: '#f44',
                marginTop: 'var(--space-1)',
              }}
            >
              {save.error}
            </div>
          )}
          {extra}
        </div>
      </div>
    </header>
  );
};

function withAlpha(color: string, alpha: number): string {
  const pct = Math.round(alpha * 100);
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`;
}

/**
 * Description blurb rendered inside a small, fixed-height scrollable
 * box. Earlier revisions used a `-webkit-line-clamp` plus a "More"
 * toggle, but the toggle reflowed the hero on click and felt heavy for
 * a piece of secondary metadata. The scroll box keeps the hero's
 * vertical footprint stable: short descriptions read as a paragraph,
 * long descriptions reveal the rest on user scroll. A bottom fade
 * hints at the extra content without taking up dedicated UI surface.
 */
const DESCRIPTION_MAX_HEIGHT_EM = 6;

const ExpandableDescription: FC<{ text: string }> = ({ text }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  // Drives the bottom-fade visibility: hide it when the user has
  // scrolled to the end so the fade doesn't fight with the final line.
  const [hasOverflow, setHasOverflow] = useState(false);
  const [atBottom, setAtBottom] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHasOverflow(el.scrollHeight > el.clientHeight + 1);
    setAtBottom(el.scrollHeight - el.clientHeight - el.scrollTop < 1);
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => {
      setHasOverflow(el.scrollHeight > el.clientHeight + 1);
      setAtBottom(el.scrollHeight - el.clientHeight - el.scrollTop < 1);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.clientHeight - el.scrollTop < 1);
  };

  return (
    <div style={{ maxWidth: '500px', position: 'relative' }}>
      <div
        ref={ref}
        onScroll={handleScroll}
        // `tabIndex` makes the scroll box keyboard-reachable so a
        // keyboard-only user can hit arrow-down to read the full text
        // without ever leaving the keyboard. Role + label make it
        // legible to screen readers as a region of text.
        tabIndex={hasOverflow ? 0 : -1}
        role="region"
        aria-label="Description"
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-tertiary)',
          margin: 0,
          lineHeight: 1.5,
          maxHeight: `${DESCRIPTION_MAX_HEIGHT_EM}em`,
          overflowY: 'auto',
          // The right gutter gives the (thin) scrollbar breathing room
          // so its track doesn't crowd the text. Padding rather than
          // margin so the scrollbar still anchors to the box's edge.
          paddingRight: 'var(--space-1)',
          // WebKit overlay scrollbars: keep them visible-on-scroll only,
          // matching the rest of the app's scrollable surfaces.
          scrollbarGutter: 'stable',
          whiteSpace: 'pre-wrap',
          // The scroll box reads as a discrete affordance only when
          // there's more to scroll to — otherwise it's just a static
          // paragraph and the cursor should stay default.
          cursor: hasOverflow ? 'auto' : 'default',
        }}
      >
        {text}
      </div>
      {hasOverflow && !atBottom && (
        // Background-agnostic "there's more below" hint: a slight darken
        // at the bottom edge. The hero gradient varies per cover, so a
        // solid-color fade would clash; pure-alpha black sits flatter
        // against whatever's behind.
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 'var(--space-1)',
            bottom: 0,
            height: '1.5em',
            pointerEvents: 'none',
            background:
              'linear-gradient(to bottom, oklch(0% 0 0 / 0) 0%, oklch(0% 0 0 / 0.35) 100%)',
          }}
        />
      )}
    </div>
  );
};
