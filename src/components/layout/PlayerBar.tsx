import { type FC, type ReactNode } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { playerApi } from '../../lib/ipc';
import type { RepeatMode } from '../../lib/types';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';

/**
 * Pick a reliable artwork URL for the player bar. The bridge sometimes
 * returns yt3.* avatar URLs with a `w\d+-h\d+` chunk rewritten to
 * `w512-h512`, which can 404. Always fall back to YouTube's thumbnail
 * service via the videoId, which is stable.
 */
function pickArtwork(track: { artworkUrl?: string | null; videoId?: string }): string | undefined {
  if (track.artworkUrl) return track.artworkUrl;
  if (track.videoId) return `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
  return undefined;
}

interface PlayerBarProps {
  onToggleNowPlaying?: () => void;
  nowPlayingOpen?: boolean;
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
      e.currentTarget.style.opacity = '0.8';
      e.currentTarget.style.transform = 'scale(1.08)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.opacity = '1';
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
}) => {
  const state = usePlayerState();
  const { track, status, positionSecs, volume, isShuffled, repeatMode, isLiked, applyOptimistic } = state;
  const isPlaying = status === 'playing';

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
  const progress = duration > 0 ? positionSecs / duration : 0;

  return (
    <footer
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
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
                border: nowPlayingOpen
                  ? '2px solid var(--color-accent)'
                  : 'none',
                cursor: 'pointer',
                transition: 'border var(--duration-fast) var(--ease-out)',
              }}
            >
              <CachedImage
                src={pickArtwork(track)}
                alt={`${track.title} artwork`}
                width={48}
                height={48}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  // If the cached/remote URL fails, swap to the YouTube
                  // thumbnail service as a last resort.
                  if (track.videoId) {
                    const fallback = `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
                    if (e.currentTarget.src !== fallback) {
                      e.currentTarget.src = fallback;
                    }
                  }
                }}
              />
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
          <TransportButton label={'\u25C4\u25C4'} onClick={() => playerApi.previous()} />
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
          <TransportButton label={'\u25BA\u25BA'} onClick={() => playerApi.next()} />
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
            {formatTime(positionSecs)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            value={positionSecs}
            onChange={(e) => playerApi.seek(Number(e.target.value))}
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
            transition: `color var(--duration-fast) var(--ease-out)`,
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
            onChange={(e) => playerApi.setVolume(Number(e.target.value) / 100)}
            style={{
              width: '80px',
              height: '4px',
              appearance: 'none',
              background: `linear-gradient(to right, var(--color-text-secondary) ${volume * 100}%, var(--color-surface-3) ${volume * 100}%)`,
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              outline: 'none',
            }}
          />
        </div>

        {onToggleNowPlaying && (
          <button
            onClick={onToggleNowPlaying}
            aria-label="Toggle now playing"
            style={{
              fontSize: 'var(--text-base)',
              color: nowPlayingOpen ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              transition: `color var(--duration-fast) var(--ease-out)`,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!nowPlayingOpen) {
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
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
