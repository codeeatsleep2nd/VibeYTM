import { type FC } from 'react';
import { usePlayerState } from '../../hooks/usePlayerState';
import { SongRow } from '../browse/SongRow';
import { playerApi } from '../../lib/ipc';

interface NowPlayingProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NowPlaying: FC<NowPlayingProps> = ({ isOpen, onClose }) => {
  const { track, queue } = usePlayerState();

  return (
    <aside
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 'var(--player-bar-height)',
        width: 'var(--now-playing-width)',
        background: 'var(--color-surface-1)',
        borderLeft: '1px solid var(--color-border, oklch(100% 0 0 / 0.06))',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: `transform var(--duration-slow) var(--ease-out)`,
        overflowY: 'auto',
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-4) var(--space-2)',
          paddingTop: 'calc(var(--title-bar-height) + var(--space-4))',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          Now Playing
        </span>
        <button
          onClick={onClose}
          aria-label="Close now playing"
          style={{
            fontSize: 'var(--text-lg)',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-sm)',
            transition: `color var(--duration-fast) var(--ease-out)`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--color-text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-text-tertiary)';
          }}
        >
          ✕
        </button>
      </div>

      {!track ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-sm)',
          }}
        >
          No track playing
        </div>
      ) : (
        <div style={{ padding: '0 var(--space-4)', flex: 1 }}>
          {/* Large artwork */}
          <div
            style={{
              width: '100%',
              aspectRatio: '1',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              background: track.artworkUrl
                ? `url(${track.artworkUrl}) center / cover`
                : 'var(--color-surface-3)',
              marginBottom: 'var(--space-4)',
            }}
          />

          {/* Track info */}
          <div
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 'var(--space-1)',
            }}
          >
            {track.title}
          </div>
          <div
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 'var(--space-1)',
              transition: `color var(--duration-fast) var(--ease-out)`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--color-text-secondary)';
            }}
          >
            {track.artist}
          </div>
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {track.album}
          </div>

          {/* Separator */}
          <div
            style={{
              height: '1px',
              background: 'oklch(100% 0 0 / 0.08)',
              margin: 'var(--space-5) 0',
            }}
          />

          {/* Up Next */}
          <div
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              textTransform: 'uppercase',
              color: 'var(--color-text-tertiary)',
              letterSpacing: '0.08em',
              marginBottom: 'var(--space-3)',
            }}
          >
            Up Next
          </div>

          {queue.length === 0 ? (
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-tertiary)',
                padding: 'var(--space-4) 0',
                textAlign: 'center',
              }}
            >
              Queue is empty
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                paddingBottom: 'var(--space-4)',
              }}
            >
              {queue.map((queueTrack, i) => (
                <SongRow
                  key={`${queueTrack.videoId}-${i}`}
                  track={queueTrack}
                  onClick={() => playerApi.playTrack(queueTrack.videoId)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
