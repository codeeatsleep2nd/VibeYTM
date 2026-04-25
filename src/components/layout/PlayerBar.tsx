import { type FC, type ReactNode, useEffect } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { preloadLyrics } from '../../hooks/useLyrics';
import { useAudioCounterpartArtwork } from '../../hooks/useAudioCounterpartArtwork';
import { albumArtOrNothing } from '../../lib/artwork';
import { ArtworkPlaceholder } from '../ArtworkPlaceholder';
import {
  browseApi,
  getActivePlaylistId,
  getPlannedNext,
  getPlannedPrevious,
  playerApi,
  setPredictedTrack,
} from '../../lib/ipc';
import type { RepeatMode } from '../../lib/types';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';

/**
 * Return an album-art URL for the player bar IF and only if it's
 * actually album art. The user-facing rule is **never show a video
 * thumbnail** — when no album art is available, we render the
 * `<ArtworkPlaceholder>` (music note glyph) instead of falling back
 * to `i.ytimg.com/vi/...`.
 */
function pickAlbumArt(track: { artworkUrl?: string | null }): string | undefined {
  return albumArtOrNothing(track.artworkUrl);
}

interface PlayerBarProps {
  onToggleNowPlaying?: () => void;
  nowPlayingOpen?: boolean;
  onToggleLyrics?: () => void;
  lyricsOpen?: boolean;
  onToggleQueue?: () => void;
  queueOpen?: boolean;
}

const formatTime = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const TransportButton: FC<{
  label: ReactNode;
  ariaLabel?: string;
  onClick: () => void;
  size?: string;
  isActive?: boolean;
}> = ({ label, ariaLabel, onClick, size = 'var(--text-lg)', isActive = false }) => (
  <button
    onClick={onClick}
    aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
    style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '36px',
      height: '36px',
      borderRadius: 'var(--radius-full)',
      fontSize: size,
      color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)',
      transition: `opacity var(--duration-fast) var(--ease-out),
                   transform var(--duration-fast) var(--ease-out)`,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'scale(1.15)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'scale(1)';
    }}
  >
    {label}
  </button>
);

/**
 * Repeat-mode glyph that distinguishes all three states:
 *   none → dim ↻ (no badge)
 *   all  → accent ↻ (no badge)
 *   one  → accent ↻ with a small "1" badge
 * Color is set on the parent button via `isActive`.
 */
const RepeatIcon: FC<{ mode: RepeatMode }> = ({ mode }) => (
  <span
    style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
    }}
  >
    {'\u21BB'}
    {mode === 'one' && (
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: -6,
          bottom: -2,
          fontSize: '9px',
          fontWeight: 700,
          lineHeight: 1,
          padding: '1px 3px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-accent)',
          color: 'oklch(100% 0 0)',
        }}
      >
        1
      </span>
    )}
  </span>
);

const REPEAT_ARIA: Record<RepeatMode, string> = {
  none: 'Repeat off',
  all: 'Repeat all',
  one: 'Repeat one',
};

const NEXT_REPEAT_MODE: Record<RepeatMode, RepeatMode> = {
  none: 'all',
  all: 'one',
  one: 'none',
};

export const PlayerBar: FC<PlayerBarProps> = ({
  onToggleNowPlaying,
  nowPlayingOpen = false,
  onToggleLyrics,
  lyricsOpen = false,
  onToggleQueue,
  queueOpen = false,
}) => {
  const state = usePlayerState();
  const { track, status, positionSecs, volume, isShuffled, repeatMode, isLiked, applyOptimistic, markSeek } = state;
  const isPlaying = status === 'playing';
  // Swap the bridge-captured artwork for the audio counterpart's
  // album cover when YTM has matched the playing music video to a
  // song. Falls back to the bridge's URL when there's no counterpart.
  const counterpartArtwork = useAudioCounterpartArtwork(
    track?.videoId,
    track?.artworkUrl,
  );

  // Preload lyrics for the upcoming track so the LRC panel opens instantly
  // when the user skips forward. Prefer the visible queue's Up Next #1
  // (published by QueuePanel via `setPlannedQueue`) — synchronous lookup,
  // no HTTP. Falls back to /next-endpoint only when the planned queue is
  // empty (cold start).
  //
  // CRITICAL: defer by 2s after a track change. When YTM's audio webview
  // navigates to a new song, in-flight fetch() calls hang for the duration
  // of the navigation (~3-15s). Firing background preloads at the same
  // moment as the navigation saturates the bridge channel and makes
  // user-driven clicks (playlist/album cards → get_playlist) appear
  // unresponsive while the queue drains. Letting the webview settle first
  // keeps the channel clear for foreground actions.
  const currentVideoId = track?.videoId;
  useEffect(() => {
    if (!currentVideoId) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;

      const planned = getPlannedNext();
      if (planned?.videoId) {
        preloadLyrics({
          videoId: planned.videoId,
          artist: planned.artist,
          title: planned.title,
          durationSecs: planned.durationSecs,
        });
        return;
      }

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
          }
        })
        .catch(() => {
          // Preload is best-effort — a failed upcoming-tracks lookup
          // just means lyrics won't be warm when the user skips.
        });
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentVideoId]);
  // Pre-probe lyrics so the LRC button can dim when a track has none.
  // No always-on lyrics probe here. Earlier versions called useLyrics
  // (enabled=true) on every track change just to dim the LRC button
  // when no lyrics existed. That fired the lyrics flow — including
  // its /next call AND the audio-counterpart re-fetch /next call —
  // even when the user never opened the panel. Per-track-change
  // bridge load was 4+ /next calls; keeping the LRC button at full
  // opacity is a fair trade for not saturating the channel. The
  // lyrics fetch still runs lazily when NowPlaying mounts the panel
  // (showLyrics + isOpen).
  const lyricsMissing = false;

  const handleTogglePlay = () => {
    // Optimistic flip — instant UI feedback. Backend's next event reconciles.
    applyOptimistic({ status: isPlaying ? 'paused' : 'playing' });
    playerApi.togglePlay().catch(() => {
      // Roll back on failure
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

  const handleToggleLike = () => {
    applyOptimistic({ isLiked: !isLiked });
    playerApi.toggleLike().catch(() => {
      applyOptimistic({ isLiked });
    });
  };
  const duration = track?.durationSecs ?? 0;
  // Clamp position so a momentary bridge/track mismatch can't pin the bar at
  // 100% (see usePlayerState: we also zero position on track-change, but the
  // clamp is the last line of defense).
  const safePosition = duration > 0 ? Math.min(positionSecs, duration) : positionSecs;
  const progress = duration > 0 ? Math.min(1, Math.max(0, safePosition / duration)) : 0;

  return (
    <footer
      style={{
        position: 'fixed',
        bottom: 0,
        left: 'var(--sidebar-width)',
        right: 0,
        height: 'var(--player-bar-height)',
        background: 'var(--color-surface-1)',
        borderTop: '1px solid oklch(100% 0 0 / 0.06)',
        display: 'grid',
        gridTemplateColumns: '1fr 2fr 1fr',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        zIndex: 100,
      }}
    >
      {/* Left: track info with thumbnail */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
        <span
          aria-label={isPlaying ? 'Playing' : 'Idle'}
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: 'var(--radius-full)',
            background: isPlaying ? 'oklch(72% 0.19 145)' : 'var(--color-text-tertiary)',
            flexShrink: 0,
            transition: `background var(--duration-normal) var(--ease-out)`,
          }}
        />
        {track ? (
          <>
            <button
              type="button"
              onClick={onToggleNowPlaying}
              aria-label={
                nowPlayingOpen ? 'Close now playing' : 'Open now playing'
              }
              aria-pressed={nowPlayingOpen}
              style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-surface-3)',
                overflow: 'hidden',
                flexShrink: 0,
                padding: 0,
                border: 'none',
                outline: 'none',
                cursor: 'pointer',
                transition: `transform var(--duration-fast) var(--ease-out)`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {(() => {
                const url = pickAlbumArt({
                  artworkUrl: counterpartArtwork ?? track.artworkUrl,
                });
                if (!url) return <ArtworkPlaceholder size={48} />;
                return (
                  <CachedImage
                    src={url}
                    alt={`${track.title} artwork`}
                    width={48}
                    height={48}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                );
              })()}
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <MarqueeText
                text={track.title}
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                }}
              />
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {track.artist}
              </div>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
            No track playing
          </div>
        )}
      </div>

      {/* Center: transport + progress */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <TransportButton
            label={'\u21CB'}
            onClick={handleToggleShuffle}
            size="var(--text-base)"
            isActive={isShuffled}
          />
          <TransportButton
            label={'\u23EE'}
            ariaLabel="Previous"
            // Play whatever's at the bottom of the visible history.
            // `setPredictedTrack` is module-level so QueuePanel (a
            // separate `usePlayerState()` instance) sees the new track
            // synchronously and lands the playing-bars animation on it
            // immediately — no waiting for the IPC / bridge round-trip.
            // Falls back to YTM's previousVideo() when the panel hasn't
            // computed a planned previous (cold start, queue empty).
            onClick={() => {
              const prev = getPlannedPrevious();
              if (prev?.videoId) {
                setPredictedTrack(prev);
                applyOptimistic({ track: prev, positionSecs: 0 });
                const pl = getActivePlaylistId() ?? undefined;
                playerApi.playTrack(prev.videoId, pl).catch(() => {});
              } else {
                playerApi.previous();
              }
            }}
          />
          <button
            onClick={handleTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-text-primary)',
              color: 'var(--color-bg)',
              fontSize: 'var(--text-base)',
              transition: `transform var(--duration-fast) var(--ease-out)`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {isPlaying ? '\u275A\u275A' : '\u25B6'}
          </button>
          <TransportButton
            label={'\u23ED'}
            ariaLabel="Next"
            // Play exactly the track shown as Up Next #1 in the queue
            // panel. `setPredictedTrack` is module-level so QueuePanel
            // (a separate `usePlayerState()` instance) sees the new
            // track synchronously and lands the playing-bars animation
            // + now-playing row on it immediately — before the IPC
            // round-trip / Rust placeholder / bridge poll have a chance
            // to settle. Falls back to YTM's nextVideo() only when no
            // planned next is available (cold start, end of queue).
            onClick={() => {
              const next = getPlannedNext();
              if (next?.videoId) {
                setPredictedTrack(next);
                applyOptimistic({ track: next, positionSecs: 0 });
                const pl = getActivePlaylistId() ?? undefined;
                playerApi.playTrack(next.videoId, pl).catch(() => {});
              } else {
                playerApi.next();
              }
            }}
          />
          <TransportButton
            label={<RepeatIcon mode={repeatMode} />}
            ariaLabel={REPEAT_ARIA[repeatMode]}
            onClick={handleCycleRepeat}
            size="var(--text-base)"
            isActive={repeatMode !== 'none'}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%', maxWidth: '480px' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', minWidth: '36px', textAlign: 'right' }}>
            {formatTime(safePosition)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            value={duration > 0 ? safePosition : 0}
            onChange={(e) => {
              // Optimistic local update so the thumb tracks the cursor without
              // waiting for the backend round-trip. markSeek lets the hook
              // discard stale pre-seek position echoes from the bridge poller
              // that would otherwise bounce the thumb back to the old spot.
              const raw = Number(e.target.value);
              // Clamp to `duration - 1.25s` so a click at the very end of a
              // short track can't trigger YTM's end-of-video auto-advance.
              // That race causes the <video> element to swap mid-poll, and
              // we briefly emit new duration + old cover/title (issue #57).
              const next = duration > 0
                ? Math.min(raw, Math.max(0, duration - 1.25))
                : raw;
              markSeek(next);
              // If we're currently playing, force the optimistic status
              // back to 'playing' too. During a seek YTM briefly reports
              // buffering/paused while the <video> reseats the buffer, and
              // that transient would otherwise flash the pause glyph
              // (issue #41). The STATUS_CHANGED echo guard needs the UI to
              // already believe it's playing to know to discard the stale
              // paused event.
              if (isPlaying) {
                applyOptimistic({ positionSecs: next, status: 'playing' });
              } else {
                applyOptimistic({ positionSecs: next });
              }
              playerApi.seek(next);
              // If the user scrubs while paused, treat the click as "resume
              // here" — standard behavior across music players.
              if (!isPlaying) {
                applyOptimistic({ status: 'playing' });
                playerApi.play().catch(() => {
                  applyOptimistic({ status: 'paused' });
                });
              }
            }}
            style={{
              flex: 1,
              height: '4px',
              appearance: 'none',
              background: `linear-gradient(to right, var(--color-accent) ${progress * 100}%, var(--color-surface-3) ${progress * 100}%)`,
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', minWidth: '36px' }}>
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right: volume + like + queue toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <button
          onClick={handleToggleLike}
          aria-label={isLiked ? 'Unlike' : 'Like'}
          style={{
            fontSize: 'var(--text-lg)',
            color: isLiked ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            cursor: 'pointer',
            transition: `color var(--duration-fast) var(--ease-out),
                         transform var(--duration-fast) var(--ease-out)`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.12)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {isLiked ? '\u2665' : '\u2661'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>{'\u266A'}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              // Optimistic local update so the thumb and gradient track the
              // cursor on click/drag instead of waiting for the backend →
              // YTM → VOLUME_CHANGED round-trip.
              const next = Number(e.target.value) / 100;
              applyOptimistic({ volume: next });
              playerApi.setVolume(next);
            }}
            style={{
              width: '80px',
              height: '4px',
              appearance: 'none',
              background: `linear-gradient(to right, var(--color-accent) ${volume * 100}%, var(--color-surface-3) ${volume * 100}%)`,
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              outline: 'none',
            }}
          />
        </div>

        {onToggleLyrics && track && (
          <button
            onClick={onToggleLyrics}
            aria-label={lyricsOpen ? 'Hide lyrics' : 'Show lyrics'}
            aria-pressed={lyricsOpen}
            title={lyricsMissing ? 'No lyrics for this track' : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: lyricsOpen ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              // Always clickable. Dim the icon slightly when we know the
              // track has no lyrics so the state is still communicated,
              // but let the user open the panel to see the "No lyrics"
              // message themselves.
              opacity: lyricsMissing && !lyricsOpen ? 0.55 : 1,
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              transition: `color var(--duration-fast) var(--ease-out),
                           transform var(--duration-fast) var(--ease-out),
                           opacity var(--duration-fast) var(--ease-out)`,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              if (!lyricsOpen) {
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!lyricsOpen) {
                e.currentTarget.style.color = 'var(--color-text-tertiary)';
              }
            }}
          >
            LRC
          </button>
        )}

        {onToggleQueue && (
          <button
            onClick={onToggleQueue}
            aria-label={queueOpen ? 'Hide queue' : 'Show queue'}
            aria-pressed={queueOpen}
            title="Playing queue"
            style={{
              fontSize: 'var(--text-base)',
              color: queueOpen ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              transition: `color var(--duration-fast) var(--ease-out),
                           transform var(--duration-fast) var(--ease-out)`,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              if (!queueOpen) {
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!queueOpen) {
                e.currentTarget.style.color = 'var(--color-text-tertiary)';
              }
            }}
          >
            {'☰'}
          </button>
        )}

        {onToggleNowPlaying && (
          <button
            onClick={onToggleNowPlaying}
            aria-label="Toggle now playing"
            style={{
              fontSize: 'var(--text-base)',
              color: nowPlayingOpen ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              transition: `color var(--duration-fast) var(--ease-out),
                           transform var(--duration-fast) var(--ease-out)`,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              if (!nowPlayingOpen) {
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!nowPlayingOpen) {
                e.currentTarget.style.color = 'var(--color-text-tertiary)';
              }
            }}
          >
            {'\uD834\uDD22'}
          </button>
        )}
      </div>
    </footer>
  );
};
