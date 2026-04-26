import { type FC } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { useAudioCounterpartArtwork } from '../../hooks/useAudioCounterpartArtwork';
import { useSmoothedPosition } from '../../hooks/useSmoothedPosition';
import { albumArtOrNothing } from '../../lib/artwork';
import { ArtworkPlaceholder } from '../ArtworkPlaceholder';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';
import { HeartFillIcon, HeartIcon } from '../icons';
import { playerApi } from '../../lib/ipc';

interface Props {
  onOpenNowPlaying: () => void;
  nowPlayingOpen: boolean;
}

const formatTime = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * The Apple-Music "Now Playing display" card. A single rounded widget
 * bundling cover + title + artist + elapsed/remaining times + a 2px
 * progress bar embedded along its bottom edge. Click the cover to open
 * the full NowPlaying panel — only entry point now (the duplicate 𝄢
 * toggle was removed in this redesign).
 */
export const NowPlayingCard: FC<Props> = ({ onOpenNowPlaying, nowPlayingOpen }) => {
  const { track, status, positionSecs, isLiked, applyOptimistic, markSeek } =
    usePlayerState();
  const isPlaying = status === 'playing';
  const counterpartArtwork = useAudioCounterpartArtwork(
    track?.videoId,
    track?.artworkUrl,
  );

  const handleToggleLike = () => {
    applyOptimistic({ isLiked: !isLiked });
    playerApi.toggleLike().catch(() => {
      applyOptimistic({ isLiked });
    });
  };

  const duration = track?.durationSecs ?? 0;
  // rAF-interpolated position so the progress bar moves smoothly at ~60fps
  // between the ~6Hz POSITION_UPDATED IPC ticks. The hook re-bases on every
  // backend sample, so it can't drift; on Pause it freezes at the latest
  // sample (no false advancement). Same hook NowPlaying uses for lyric sync.
  const smoothedPositionSecs = useSmoothedPosition(positionSecs, isPlaying);
  const safePosition =
    duration > 0
      ? Math.min(smoothedPositionSecs, duration)
      : smoothedPositionSecs;
  const progress =
    duration > 0 ? Math.min(1, Math.max(0, safePosition / duration)) : 0;
  const remaining = Math.max(0, duration - safePosition);

  const artUrl = albumArtOrNothing(counterpartArtwork ?? track?.artworkUrl ?? null);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: '100%',
        maxWidth: '520px',
        height: '56px',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)',
        padding: '6px var(--space-3) 6px 6px',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <button
        type="button"
        onClick={onOpenNowPlaying}
        aria-label={nowPlayingOpen ? 'Close now playing' : 'Open now playing'}
        aria-pressed={nowPlayingOpen}
        style={{
          width: '44px',
          height: '44px',
          flexShrink: 0,
          padding: 0,
          background: 'var(--color-surface-3)',
          overflow: 'hidden',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          border: 'none',
        }}
      >
        {artUrl ? (
          <CachedImage
            src={artUrl}
            alt=""
            width={44}
            height={44}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <ArtworkPlaceholder size={44} />
        )}
      </button>

      <div
        style={{
          minWidth: 0,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '2px',
          lineHeight: 1.2,
        }}
      >
        {track ? (
          <>
            <MarqueeText
              text={track.title}
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
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
              {track.album ? (
                <span style={{ opacity: 0.7 }}> — {track.album}</span>
              ) : null}
            </div>
          </>
        ) : (
          <span
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            Not playing
          </span>
        )}
      </div>

      {track && (
        <button
          type="button"
          onClick={handleToggleLike}
          aria-label={isLiked ? 'Unlike' : 'Like'}
          aria-pressed={isLiked}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '26px',
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: isLiked
              ? 'var(--color-accent)'
              : 'var(--color-text-tertiary)',
            transition: 'color var(--duration-fast) var(--ease-out)',
          }}
          onMouseEnter={(e) => {
            if (!isLiked) {
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isLiked) {
              e.currentTarget.style.color = 'var(--color-text-tertiary)';
            }
          }}
        >
          {isLiked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}
        </button>
      )}

      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-end',
          gap: '2px',
          lineHeight: 1.2,
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
          minWidth: '40px',
        }}
      >
        <span>{formatTime(safePosition)}</span>
        <span>−{formatTime(remaining)}</span>
      </div>

      {track && duration > 0 && (
        <input
          type="range"
          data-vibeytm-slider
          min={0}
          max={duration}
          value={safePosition}
          aria-label="Seek"
          onChange={(e) => {
            const raw = Number(e.target.value);
            const next = Math.min(raw, Math.max(0, duration - 1.25));
            markSeek(next);
            if (isPlaying) {
              applyOptimistic({ positionSecs: next, status: 'playing' });
            } else {
              applyOptimistic({ positionSecs: next });
            }
            playerApi.seek(next);
            if (!isPlaying) {
              applyOptimistic({ status: 'playing' });
              playerApi.play().catch(() => {
                applyOptimistic({ status: 'paused' });
              });
            }
          }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            // Track and thumb both centered in the 12px input, so the
            // hover thumb sits ON the visible 3px band. Visible band is
            // ~4-5px above the card's bottom edge — close enough to
            // "embedded at bottom" without breaking thumb alignment.
            backgroundImage: `linear-gradient(to right, var(--color-text-secondary) ${
              progress * 100
            }%, var(--color-surface-3) ${progress * 100}%)`,
          }}
        />
      )}
    </div>
  );
};
