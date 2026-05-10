import { type FC, type ReactNode, useEffect, useRef, useState } from 'react';
import { LiquidGlass } from '@liquidglass/react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { preloadLyrics } from '../../hooks/useLyrics';
import { preloadAudioCounterpartArtwork } from '../../hooks/useAudioCounterpartArtwork';
import {
  BRIDGE_SETTLE_MS,
  useDeferredEffect,
} from '../../hooks/useBridgeSafeFetch';
import { isAlbumArtUrl } from '../../lib/artwork';
import { lookupTrackArtwork } from '../../lib/trackArtworkRegistry';
import {
  browseApi,
  cacheApi,
  getActivePlaylistId,
  getPlannedNext,
  getPlannedPrevious,
  playerApi,
  setPredictedTrack,
} from '../../lib/ipc';
import type { RepeatMode } from '../../lib/types';
import {
  ClockIcon,
  LyricsIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SpeakerHighIcon,
  SpeakerLowIcon,
  SpeakerMuteIcon,
} from '../icons';
import { NowPlayingCard } from '../player/NowPlayingCard';

interface PlayerChromeProps {
  onToggleNowPlaying: () => void;
  nowPlayingOpen: boolean;
  onToggleLyrics: () => void;
  lyricsOpen: boolean;
  onToggleQueue: () => void;
  queueOpen: boolean;
  onToggleFocusTimer: () => void;
  focusTimerOpen: boolean;
}

// PlayerChrome stays at the bottom (preserves original PlayerBar location
// & size). The Apple Music visual treatment — flat SVG transports, the
// rounded "Now Playing display" card in the center, the slim hover-reveal
// sliders — is applied to the bar itself, not its position. No
// traffic-light reservation needed: the bottom chrome doesn't overlap
// with the title-bar window controls.

const NEXT_REPEAT_MODE: Record<RepeatMode, RepeatMode> = {
  none: 'all',
  all: 'one',
  one: 'none',
};

const REPEAT_ARIA: Record<RepeatMode, string> = {
  none: 'Repeat off',
  all: 'Repeat all',
  one: 'Repeat one',
};

interface ChromeButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  isActive?: boolean;
  size?: number;
  /** Render greyed-out and ignore clicks. Used by the lyrics button
   *  when a podcast is playing — there are no lyrics to look up. */
  disabled?: boolean;
}

/**
 * Flat icon button used for both transport (play/prev/next/etc.) and
 * utility (volume/lyrics/queue) controls. Apple Music's chrome uses
 * solid white-ish glyphs at rest, accent when toggled on. Hover bumps
 * opacity slightly for affordance — no scale, no background swap.
 *
 * MUST stay a real `<button>` (CLAUDE.md WKWebView rule); naked SVGs
 * inside a `data-tauri-drag-region` ancestor would be eaten by the
 * window-drag handler.
 */
const ChromeButton: FC<ChromeButtonProps> = ({
  label,
  onClick,
  children,
  isActive = false,
  size = 28,
  disabled = false,
}) => {
  const restingOpacity = disabled ? 0.35 : isActive ? 1 : 0.92;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-label={label}
      aria-pressed={isActive}
      aria-disabled={disabled}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${size}px`,
        height: `${size}px`,
        padding: 0,
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: isActive
          ? 'var(--color-accent)'
          : 'var(--color-text-primary)',
        opacity: restingOpacity,
        transition:
          'color var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out)',
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.opacity = isActive ? '1' : '0.92';
      }}
    >
      {children}
    </button>
  );
};

export const PlayerChrome: FC<PlayerChromeProps> = ({
  onToggleNowPlaying,
  nowPlayingOpen,
  onToggleLyrics,
  lyricsOpen,
  onToggleQueue,
  queueOpen,
  onToggleFocusTimer,
  focusTimerOpen,
}) => {
  const state = usePlayerState();
  const { track, status, volume, isShuffled, repeatMode, applyOptimistic, activePlaylistId } = state;
  const isPlaying = status === 'playing';
  // YTM podcasts/shows ride the same player surface as music, but have
  // no lyrics to look up — the LRC fetch (LRCLIB / NetEase) is built
  // around song title + artist, not episode metadata. Detect via the
  // active playlist context: MPSP* browseIds are show / podcast feeds.
  const isPodcastContext = (activePlaylistId ?? '').startsWith('MPSP');

  // Background preload of the CURRENT track's lyrics + the next track's
  // lyrics + cover. Routed through `useDeferredEffect` so the bridge
  // settles after a track change before any of these IPCs fire (see
  // CLAUDE.md "Background fetches need a settle delay after track
  // change"). Cache-first via three tiers:
  //   1. trackArtworkRegistry (populated by playlist visits)
  //   2. track.artworkUrl when it's already album art
  //   3. preloadAudioCounterpartArtwork (Rust /next lookup)
  // The CURRENT track preload makes the LRC panel render instantly the
  // next time the user opens it.
  const currentVideoId = track?.videoId;
  const currentArtist = track?.artist;
  const currentTitle = track?.title;
  const currentDuration = track?.durationSecs;
  useDeferredEffect(
    () => {
      if (!currentVideoId) return;

      preloadLyrics({
        videoId: currentVideoId,
        artist: currentArtist ?? null,
        title: currentTitle ?? null,
        durationSecs: currentDuration ?? null,
      });

      const warmCoverFor = (next: {
        videoId: string;
        artworkUrl?: string | null;
      }): void => {
        let coverUrl = lookupTrackArtwork(next.videoId);
        if (!coverUrl && isAlbumArtUrl(next.artworkUrl)) {
          coverUrl = next.artworkUrl as string;
        }
        if (coverUrl) {
          void cacheApi.fetchImage(coverUrl).catch(() => {});
          return;
        }
        preloadAudioCounterpartArtwork(next.videoId);
      };

      const planned = getPlannedNext();
      if (planned?.videoId) {
        preloadLyrics({
          videoId: planned.videoId,
          artist: planned.artist,
          title: planned.title,
          durationSecs: planned.durationSecs,
        });
        warmCoverFor({
          videoId: planned.videoId,
          artworkUrl: planned.artworkUrl,
        });
        return;
      }

      let cancelled = false;
      browseApi
        .getUpcomingTracks(currentVideoId, 2)
        .then((tracks) => {
          if (cancelled) return;
          const next = tracks.find(
            (t) => t.videoId && t.videoId !== currentVideoId,
          );
          if (next) {
            preloadLyrics({
              videoId: next.videoId,
              artist: next.artist,
              title: next.title,
              durationSecs: next.durationSecs,
            });
            warmCoverFor({
              videoId: next.videoId,
              artworkUrl: next.artworkUrl,
            });
          }
        })
        .catch(() => {
          // Best-effort preload; the on-demand fetch path covers misses.
        });
      return () => {
        cancelled = true;
      };
    },
    [currentVideoId, currentArtist, currentTitle, currentDuration],
    BRIDGE_SETTLE_MS,
  );

  const handleTogglePlay = () => {
    applyOptimistic({ status: isPlaying ? 'paused' : 'playing' });
    playerApi.togglePlay().catch(() => {
      applyOptimistic({ status: isPlaying ? 'playing' : 'paused' });
    });
  };

  const handleToggleShuffle = () => {
    applyOptimistic({ isShuffled: !isShuffled });
    playerApi.toggleShuffle().catch(() => {
      applyOptimistic({ isShuffled });
    });
  };

  const handleCycleRepeat = () => {
    applyOptimistic({ repeatMode: NEXT_REPEAT_MODE[repeatMode] });
    playerApi.cycleRepeat().catch(() => {
      applyOptimistic({ repeatMode });
    });
  };

  // Planned-prev/next pattern (load-bearing): set the predicted track
  // module-level FIRST so QueuePanel's separate usePlayerState instance
  // sees the new track synchronously and lands the now-playing-bars
  // animation before the IPC round-trip lands. Falls back to YTM's
  // previous/next when no planned track is available (cold start).
  //
  // SHUFFLE EXCEPTION (issue #81): when shuffle is on, the planned queue
  // mirrors the visible (playlist) order — playing the "next" planned
  // track would defeat shuffle and play the linearly-next song. Fall
  // through to YTM's `nextVideo()` which respects YTM's internal shuffle
  // cursor and picks a random upcoming track. Same for previous.
  const handlePrev = () => {
    const prev = isShuffled ? null : getPlannedPrevious();
    if (prev?.videoId) {
      setPredictedTrack(prev);
      applyOptimistic({ track: prev, positionSecs: 0 });
      const pl = getActivePlaylistId() ?? undefined;
      playerApi.playTrack(prev.videoId, pl).catch(() => {});
    } else {
      playerApi.previous();
    }
  };
  const handleNext = () => {
    const next = isShuffled ? null : getPlannedNext();
    if (next?.videoId) {
      setPredictedTrack(next);
      applyOptimistic({ track: next, positionSecs: 0 });
      const pl = getActivePlaylistId() ?? undefined;
      playerApi.playTrack(next.videoId, pl).catch(() => {});
    } else {
      playerApi.next();
    }
  };

  const SpeakerGlyph =
    volume === 0
      ? SpeakerMuteIcon
      : volume < 0.5
        ? SpeakerLowIcon
        : SpeakerHighIcon;

  // Remember the pre-mute volume so clicking the speaker glyph toggles
  // between mute and the user's previous level. Default to 0.5 if the
  // user opened the app already at 0 (so unmute does something visible).
  const lastNonZeroVolumeRef = useRef<number>(volume > 0 ? volume : 0.5);
  // Volume slider visibility — Apple-Music-style hover reveal. The
  // slider sits next to the speaker button; both share a wrapper that
  // toggles `isVolumeHovered` on enter/leave. Width animates from 0
  // (collapsed) → 55px (expanded) so the slot doesn't visually
  // jitter the surrounding chrome on toggle.
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);
  useEffect(() => {
    if (volume > 0) lastNonZeroVolumeRef.current = volume;
  }, [volume]);

  const handleToggleMute = () => {
    const previous = volume;
    const next = volume === 0 ? lastNonZeroVolumeRef.current : 0;
    applyOptimistic({ volume: next });
    // Revert to the pre-toggle value if the IPC fails — otherwise the UI
    // shows a mute/unmute state that was never applied to the YTM engine.
    playerApi.setVolume(next).catch(() => applyOptimistic({ volume: previous }));
  };

  return (
    <footer
      // Positioning wrapper — a fixed strip at the bottom of the
      // window. The visible glass capsule is the `<LiquidGlass>` child;
      // matches the floating-pill shape used by every page's top
      // title plate.
      style={{
        position: 'fixed',
        bottom: 'var(--space-3)',
        // Both gutters use `--space-6` (24 px) — same as the page
        // section's horizontal padding above. Equal visible gap on
        // both sides of the chrome capsule, window-size-independent.
        // Reads `--sidebar-effective-width` (set on AppShell root) so
        // the chrome slides left in lockstep with the sidebar's
        // collapse animation. Falls back to `--sidebar-width` for any
        // ancestor that didn't define the effective variable, matching
        // the legacy "always pinned right of the sidebar" behavior.
        left:
          'calc(var(--sidebar-effective-width, var(--sidebar-width)) + var(--space-6))',
        right: 'var(--space-6)',
        // Slide left/right at the same cadence as the sidebar collapses
        // so the chrome doesn't snap mid-animation. The grid column
        // shrinks via the AppShell's transition; this keeps the chrome's
        // computed `left` in step with it.
        transition: 'left var(--duration-slow) var(--ease-out)',
        // Explicit height — `<LiquidGlass>` inside takes 100 % of its
        // parent. Without this the footer auto-fits and the WebGL/SVG
        // wrapper collapses, clipping the controls' top edge.
        height: 'var(--player-bar-height)',
        // Above every overlay surface so the floating capsule is
        // never occluded — sits below only the title-bar drag region
        // (z 200, top of window only).
        zIndex: 150,
      }}
    >
      <LiquidGlass
        borderRadius={150}
        // blur=40 matches the NowPlaying overlay's
        // `backdrop-filter: blur(40px) saturate(180%)`. The
        // LiquidGlass component applies blur via its OWN
        // backdrop-filter on the capsule div (the inner-content
        // div's own backdrop-filter only filters the LiquidGlass
        // output, not the page underneath — filters don't chain).
        blur={40}
        contrast={1.2}
        brightness={1.05}
        saturation={1.8}
        shadowIntensity={0.25}
        displacementScale={1}
        elasticity={1}
        zIndex={150}
      ><div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--space-10)',
          gap: 'var(--space-3)',
          // Semi-transparent dark wash + heavy backdrop-filter (same
          // recipe SafeOverlay uses for the NowPlaying / queue
          // surfaces) so the chrome's blur character matches the
          // other glass plates instead of relying only on
          // LiquidGlass's own filter (which WebKit drops the SVG
          // displacement portion of).
          background: 'oklch(20% 0.005 270 / 0.30)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          borderRadius: 'inherit',
        }}
      >
      {/* LEFT — transports (Apple Music: flat white glyphs, prev/play/next
          rendered as filled SF-Symbol shapes; shuffle/repeat are smaller
          stroke icons that bracket the row at lower visual weight) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          flexShrink: 0,
        }}
      >
        <ChromeButton
          label="Shuffle"
          onClick={handleToggleShuffle}
          isActive={isShuffled}
          size={28}
        >
          <ShuffleIcon size={16} />
        </ChromeButton>
        <ChromeButton label="Previous" onClick={handlePrev} size={32}>
          <PrevIcon size={22} fill="currentColor" />
        </ChromeButton>
        <ChromeButton
          label={isPlaying ? 'Pause' : 'Play'}
          onClick={handleTogglePlay}
          size={40}
        >
          {isPlaying ? (
            <PauseIcon size={30} fill="currentColor" />
          ) : (
            <PlayIcon size={30} fill="currentColor" />
          )}
        </ChromeButton>
        <ChromeButton label="Next" onClick={handleNext} size={32}>
          <NextIcon size={22} fill="currentColor" />
        </ChromeButton>
        <ChromeButton
          label={REPEAT_ARIA[repeatMode]}
          onClick={handleCycleRepeat}
          isActive={repeatMode !== 'none'}
          size={28}
        >
          {repeatMode === 'one' ? (
            <RepeatOneIcon size={16} />
          ) : (
            <RepeatIcon size={16} />
          )}
        </ChromeButton>
      </div>

      {/* CENTER — Now Playing display card (Apple Music's signature widget) */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          minWidth: 0,
        }}
      >
        <NowPlayingCard
          onOpenNowPlaying={onToggleNowPlaying}
          nowPlayingOpen={nowPlayingOpen}
        />
      </div>

      {/* RIGHT — utilities (Apple Music: volume + lyrics-bubble + avatar; we
          keep queue since it's a project feature AM has no equivalent for) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          flexShrink: 0,
        }}
      >
        <div
          // Apple-Music-style volume control: speaker button always
          // visible, slider hidden by default and revealed on hover
          // over either the button or the slider's reserved slot. Both
          // share a wrapper so the slider stays open while the user
          // moves between button and slider thumb. Width animates so
          // the chrome doesn't jitter during the reveal.
          onMouseEnter={() => setIsVolumeHovered(true)}
          onMouseLeave={() => setIsVolumeHovered(false)}
          onFocus={() => setIsVolumeHovered(true)}
          onBlur={() => setIsVolumeHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
        >
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={volume === 0 ? 'Unmute' : 'Mute'}
            aria-pressed={volume === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '22px',
              height: '22px',
              padding: 0,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              transition: 'color var(--duration-fast) var(--ease-out)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)';
            }}
          >
            <SpeakerGlyph size={18} />
          </button>
          <input
            type="range"
            data-vibeytm-slider
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              const previous = volume;
              const next = Number(e.target.value) / 100;
              applyOptimistic({ volume: next });
              // Revert if IPC fails — matches the optimistic-revert pattern
              // used by every other transport handler in this component.
              playerApi.setVolume(next).catch(() =>
                applyOptimistic({ volume: previous }),
              );
            }}
            aria-label="Volume"
            tabIndex={isVolumeHovered ? 0 : -1}
            style={{
              width: isVolumeHovered ? '55px' : '0px',
              opacity: isVolumeHovered ? 1 : 0,
              pointerEvents: isVolumeHovered ? 'auto' : 'none',
              overflow: 'hidden',
              transition:
                'width var(--duration-normal) var(--ease-out), opacity var(--duration-normal) var(--ease-out)',
              backgroundImage: `linear-gradient(to right, var(--color-text-secondary) ${
                volume * 100
              }%, var(--color-surface-3) ${volume * 100}%)`,
            }}
          />
        </div>

        {track && (
          <ChromeButton
            label={
              isPodcastContext
                ? 'Lyrics unavailable for podcasts'
                : lyricsOpen
                  ? 'Hide lyrics'
                  : 'Show lyrics'
            }
            onClick={onToggleLyrics}
            isActive={lyricsOpen && !isPodcastContext}
            disabled={isPodcastContext}
            size={28}
          >
            <LyricsIcon size={20} />
          </ChromeButton>
        )}

        <ChromeButton
          label={queueOpen ? 'Hide queue' : 'Show queue'}
          onClick={onToggleQueue}
          isActive={queueOpen}
          size={28}
        >
          <QueueIcon size={20} />
        </ChromeButton>

        <ChromeButton
          label={focusTimerOpen ? 'Hide focus timer' : 'Show focus timer'}
          onClick={onToggleFocusTimer}
          isActive={focusTimerOpen}
          size={28}
        >
          <ClockIcon size={20} />
        </ChromeButton>
      </div>
      </div>
      </LiquidGlass>
    </footer>
  );
};
