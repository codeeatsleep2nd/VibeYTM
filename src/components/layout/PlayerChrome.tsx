import { type FC, type ReactNode, useEffect, useRef } from 'react';
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
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    aria-pressed={isActive}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: `${size}px`,
      height: `${size}px`,
      padding: 0,
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: isActive
        ? 'var(--color-accent)'
        : 'var(--color-text-primary)',
      opacity: isActive ? 1 : 0.92,
      transition:
        'color var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out)',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.opacity = '1';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.opacity = isActive ? '1' : '0.92';
    }}
  >
    {children}
  </button>
);

export const PlayerChrome: FC<PlayerChromeProps> = ({
  onToggleNowPlaying,
  nowPlayingOpen,
  onToggleLyrics,
  lyricsOpen,
  onToggleQueue,
  queueOpen,
}) => {
  const state = usePlayerState();
  const { track, status, volume, isShuffled, repeatMode, applyOptimistic } = state;
  const isPlaying = status === 'playing';

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
  const handlePrev = () => {
    const prev = getPlannedPrevious();
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
    const next = getPlannedNext();
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
      style={{
        position: 'fixed',
        bottom: 0,
        left: 'var(--sidebar-width)',
        right: 0,
        height: 'var(--player-bar-height)',
        // CSS-driven Liquid Glass plate. Tuned to stay readable as glass
        // even when the page content directly above the chrome is dark
        // (so the surface character doesn't depend on backdrop colour):
        //
        //   1. background — a stacked translucent gradient on a slightly
        //      lifted base (oklch 28%). The top 4 % is a near-white wash
        //      (12 % opacity) that the rim catches; the bottom is a
        //      darker fade that grounds the plate. Even with dark
        //      content behind, the wash is visible.
        //   2. backdrop-filter — blur(48 px) saturate(220 %) keeps the
        //      colour bleed-through saturated; the smaller blur radius
        //      vs. the previous 56 px lets shapes/colour read more
        //      clearly through the plate instead of greying out.
        //   3. inset top highlight + bright top border — the visible rim
        //      that sells the surface as a discrete physical plate.
        //      0.28 opacity is intentionally bright; without it the
        //      chrome reads as a flat panel against dark content.
        //   4. outer drop shadow — separates the chrome from the page.
        //
        // Apple Music's chrome works the same way — the rim highlight is
        // doing most of the visual work, the blur is supporting cast.
        background:
          'linear-gradient(180deg, oklch(100% 0 0 / 0.12) 0%, oklch(100% 0 0 / 0.04) 4%, oklch(100% 0 0 / 0) 30%, oklch(0% 0 0 / 0.18) 100%), oklch(28% 0 0 / 0.62)',
        backdropFilter: 'blur(48px) saturate(220%) brightness(1.05)',
        WebkitBackdropFilter: 'blur(48px) saturate(220%) brightness(1.05)',
        borderTop: '1px solid oklch(100% 0 0 / 0.18)',
        boxShadow:
          'inset 0 1px 0 oklch(100% 0 0 / 0.28), inset 0 -1px 0 oklch(0% 0 0 / 0.30), 0 -12px 36px oklch(0% 0 0 / 0.35)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        gap: 'var(--space-3)',
        zIndex: 100,
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
            style={{
              width: '55px', /* 2/3 of prior 83px */
              backgroundImage: `linear-gradient(to right, var(--color-text-secondary) ${
                volume * 100
              }%, var(--color-surface-3) ${volume * 100}%)`,
            }}
          />
        </div>

        {track && (
          <ChromeButton
            label={lyricsOpen ? 'Hide lyrics' : 'Show lyrics'}
            onClick={onToggleLyrics}
            isActive={lyricsOpen}
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
      </div>
    </footer>
  );
};
