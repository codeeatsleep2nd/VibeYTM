import { type FC } from 'react';
import { LiquidGlass } from '@liquidglass/react';
import { usePlayerState } from '../../../hooks/usePlayerState';
import { useAudioCounterpartArtwork } from '../../../hooks/useAudioCounterpartArtwork';
import { useCoverColors } from '../../../hooks/useCoverColors';
import { albumArtOrNothing } from '../../../lib/artwork';
import { ArtworkPlaceholder } from '../../ArtworkPlaceholder';
import { CachedImage } from '../../CachedImage';
import { MarqueeText } from '../../MarqueeText';
import { SafeOverlay } from '../../overlay/SafeOverlay';
import { CoverBackdrop } from './CoverBackdrop';

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
  // open, even though only one renders content at a time. The lyrics panel
  // itself is now an independent overlay (LyricsOverlay) — NowPlaying just
  // owns the cover positioning so the cover slides left to make room.
  const splitMode = showLyrics || queueOpen;
  const { track } = usePlayerState();

  return (
    <SafeOverlay
      isOpen={isOpen}
      ariaLabel="Now playing"
      slideFrom="bottom"
      zIndex={80}
      // Cover the entire main content area (right of the sidebar) —
      // top to bottom of the window, edge to edge of the right side.
      // Sidebar stays visible on the left; title-bar drag region and
      // player chrome remain on top via their higher z-indexes.
      inset={{
        top: '0',
        left: 'var(--sidebar-width)',
        right: '0',
        bottom: '0',
      }}
      background="transparent"
      backdropFilter="blur(40px) saturate(180%)"
      boxShadow="0 -8px 32px oklch(0% 0 0 / 0.35)"
    >
      <NowPlayingBody
        splitMode={splitMode}
        track={track}
        coverSide={coverSide}
      />
    </SafeOverlay>
  );
};

// Body renders the cover + title block. The lyrics surface lives in its
// own top-level overlay (`LyricsOverlay`) so the playing page can stay
// closed when the user only wants lyrics.
interface NowPlayingBodyProps {
  splitMode: boolean;
  track: ReturnType<typeof usePlayerState>['track'];
  coverSide: string;
}

const NowPlayingBody: FC<NowPlayingBodyProps> = ({
  splitMode,
  track,
  coverSide,
}) => {
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
        // When a side drawer is open, anchor the cover on the LEFT (instead
        // of centered) so it sits in the same place the old in-overlay
        // split layout put it — leaving the right portion clear for the
        // independently-rendered LyricsOverlay / QueuePanel.
        justifyContent: splitMode ? 'flex-start' : 'center',
        paddingTop:
          'calc(var(--title-bar-height) + var(--space-3))',
        paddingLeft: 'var(--space-6)',
        paddingRight: 'var(--space-6)',
        paddingBottom: 0,
        transition: 'justify-content 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        overflow: 'hidden',
      }}
    >
      <CoverBackdrop colors={coverColors} coverUrl={backdropUrl} />
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
        <div
          style={{
            position: 'relative',
            zIndex: 1,
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
        flexShrink: 0,
        // Smooth resize when the split mode toggles.
        transition: 'width var(--duration-slow) var(--ease-out)',
      }}
    >
      {/* Liquid-glass rim around the cover — matches the edge treatment
          used on the player chrome and title plates. The cover image
          sits inside the LiquidGlass capsule so the same generator
          preset (radius/contrast/brightness/saturation/displacement)
          decorates its border. */}
      <LiquidGlass
        borderRadius={24}
        blur={0}
        contrast={1.2}
        brightness={1.05}
        saturation={1.8}
        shadowIntensity={0.5}
        displacementScale={1}
        elasticity={1}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 'inherit',
            overflow: 'hidden',
            background: 'var(--color-surface-2)',
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
      </LiquidGlass>
    </div>
  );
};

