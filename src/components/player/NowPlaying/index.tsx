import { type FC } from 'react';
import { LiquidGlass } from '@liquidglass/react';
import { usePlayerState } from '../../../hooks/usePlayerState';
import { useAudioCounterpartArtwork } from '../../../hooks/useAudioCounterpartArtwork';
import { useExternalCoverFallback } from '../../../hooks/useExternalCoverFallback';
import { useCoverColors } from '../../../hooks/useCoverColors';
import { albumArtOrNothing } from '../../../lib/artwork';
import { lookupTrackArtwork } from '../../../lib/trackArtworkRegistry';
import { lookupShowCover } from '../../../lib/showCoverRegistry';
import { openArtist, openPlaylist } from '../../../lib/appNav';
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
  const { track, activePlaylistId } = usePlayerState();

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
        activePlaylistId={activePlaylistId ?? null}
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
  activePlaylistId: string | null;
}

const NowPlayingBody: FC<NowPlayingBodyProps> = ({
  splitMode,
  track,
  coverSide,
  activePlaylistId,
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
          <Cover
            track={track}
            size="split"
            activePlaylistId={activePlaylistId}
          />
          <TitleBlock
            track={track}
            width={coverSide}
            align="center"
            activePlaylistId={activePlaylistId}
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
  /** Active source-playlist context for the currently playing track. When
   *  it starts with `MPSP`, the artist line links to the show's MPSP page
   *  instead of triggering an artist search. */
  activePlaylistId: string | null;
}

const TitleBlock: FC<TitleBlockProps> = ({
  track,
  width,
  align,
  activePlaylistId,
}) => {
  // Podcast / show episodes: artist field carries the show name (see
  // parse_episode_from_multi_row), and `activePlaylistId` is the show's
  // MPSP* browseId. Click should jump to the show page rather than to
  // an artist-search of the show's name.
  const isPodcastEpisode = (activePlaylistId ?? '').startsWith('MPSP');
  const handleArtistClick = (): void => {
    if (isPodcastEpisode && activePlaylistId) {
      openPlaylist(activePlaylistId);
      return;
    }
    if (track.artist) {
      openArtist(track.artist);
    }
  };
  const canNavigate = isPodcastEpisode
    ? !!activePlaylistId
    : !!track.artist;
  return (
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
      <button
        type="button"
        onClick={canNavigate ? handleArtistClick : undefined}
        disabled={!canNavigate}
        aria-label={
          isPodcastEpisode
            ? `Open show ${track.artist}`
            : `Open artist ${track.artist}`
        }
        style={{
          display: 'block',
          width: '100%',
          marginTop: 'var(--space-2)',
          padding: 0,
          background: 'none',
          border: 'none',
          fontSize: 'var(--text-base)',
          color: 'var(--color-text-secondary)',
          textAlign: align,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: canNavigate ? 'pointer' : 'default',
        }}
        onMouseEnter={(e) => {
          if (canNavigate) e.currentTarget.style.color = 'var(--color-text-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--color-text-secondary)';
        }}
      >
        {track.artist}
      </button>
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
};

interface CoverProps {
  // Issue #65 — added artist + durationSecs so the external cover
  // fallback (`useExternalCoverFallback`) can key its iTunes Search
  // query on (artist, title, duration). Both optional so existing
  // call sites that don't have the data don't have to add it.
  track: {
    title: string;
    videoId?: string;
    artworkUrl?: string;
    artist?: string;
    durationSecs?: number;
  };
  /** `full`: largest square that fits the viewport.
   *  `split`: fixed medium size used alongside the lyrics panel. */
  size: 'full' | 'split';
  /** Active source-playlist context. When it starts with `MPSP*`, the
   *  cover falls back to the show's channel art (looked up by browseId
   *  in the show-cover registry) since podcast episodes don't surface
   *  album art through the audio-counterpart hook. */
  activePlaylistId: string | null;
}

  // Single square side length used in BOTH cover-only and split modes so
  // toggling the LRC button never resizes the cover. Constrained by:
  //   • the 2/3 fraction of the 1200px-capped split row (horizontal cap),
  //   • the same 2/3 of available viewport width on narrower windows,
  //   • the viewport height minus chrome + title block so the cover fits.
  const SPLIT_ROW_MAX = 1200;
  const SPLIT_COVER_FRACTION = 2 / 3;
  const coverSide = `min(${SPLIT_ROW_MAX * SPLIT_COVER_FRACTION}px, calc(${SPLIT_COVER_FRACTION} * (100vw - var(--sidebar-width) - var(--space-6) * 2)), calc(100vh - var(--title-bar-height) - var(--player-bar-height) - var(--space-3) - 160px))`;

const Cover: FC<CoverProps> = ({ track, size, activePlaylistId }) => {
  void size; // kept for API compatibility; both modes now share one size
  const sideLength = coverSide;
  const counterpartArtwork = useAudioCounterpartArtwork(
    track.videoId,
    track.artworkUrl,
  );
  // Issue #65 — UGC fallback (see hook docstring).
  const externalCover = useExternalCoverFallback({
    videoId: track.videoId,
    artist: track.artist,
    title: track.title,
    durationSecs: track.durationSecs,
    bridgeArtworkUrl: counterpartArtwork ?? track.artworkUrl,
  });
  const isPodcastContext = (activePlaylistId ?? '').startsWith('MPSP');
  const showCoverUrl = isPodcastContext
    ? lookupShowCover(activePlaylistId)
    : undefined;
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
            // For podcast / show episodes, prefer the show's channel
            // art. Pulled from the show-cover registry (populated by
            // PlaylistDetailPage when the user visits any MPSP
            // playlist), keyed by the active MPSP browseId rather
            // than per-episode videoId. Bypasses the album-art host
            // filter because the channel page renders the same URL
            // via `<CachedImage>` with no host check, so we can trust
            // it here too. NEVER falls back to a video thumbnail.
            // Source order:
            //   1. Show-cover registry (if podcast context)
            //   2. Audio counterpart's album cover (from /next)
            //   3. Bridge's captured artworkUrl
            //   4. Per-track artwork registry
            // Falls through to placeholder only when none resolve.
            const url =
              showCoverUrl ??
              albumArtOrNothing(counterpartArtwork) ??
              albumArtOrNothing(track.artworkUrl) ??
              albumArtOrNothing(lookupTrackArtwork(track.videoId)) ??
              externalCover;
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

