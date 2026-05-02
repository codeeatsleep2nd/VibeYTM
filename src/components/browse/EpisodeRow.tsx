import { type FC, useState } from 'react';
import type { TrackInfo } from '../../lib/types';
import { playerApi } from '../../lib/ipc';
import { CachedImage } from '../CachedImage';
import { ContextMenuTarget } from '../contextMenu/ContextMenu';
import { buildTrackContextMenu } from '../contextMenu/trackActions';

interface EpisodeRowProps {
  /** The episode's TrackInfo. Reads `description` and `publishedAt`
   *  alongside the standard fields when present. */
  track: TrackInfo;
  /** Show / podcast playlistId. Drives the playback context. */
  playlistId?: string;
}

/**
 * Format an episode's duration in long-form ("36 min", "1 hr 30 min")
 * to match the YTM web layout for podcasts. Falls back to MM:SS for
 * sub-minute clips.
 */
const formatEpisodeDuration = (secs: number): string => {
  if (secs <= 0) return '';
  const totalMinutes = Math.floor(secs / 60);
  if (totalMinutes < 1) return `${Math.floor(secs)} sec`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
};

/**
 * Detail-rich row for a single podcast / show episode. Larger cover,
 * publish-date eyebrow above the title, full duration, and a 3-line
 * description preview underneath. Clicking the row plays the episode.
 *
 * Mirrors SongRow's playback + context-menu behavior so users get the
 * same affordances they have for music tracks; only the visual layout
 * is enriched with the episode-specific metadata.
 */
export const EpisodeRow: FC<EpisodeRowProps> = ({ track, playlistId }) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (track.videoId) {
      playerApi.playTrack(track.videoId, playlistId).catch(() => {});
    }
  };

  const durationLabel = formatEpisodeDuration(track.durationSecs);
  const metaParts: string[] = [];
  if (track.publishedAt) metaParts.push(track.publishedAt);
  if (durationLabel) metaParts.push(durationLabel);

  return (
    <ContextMenuTarget buildSections={() => buildTrackContextMenu({ track })}>
      <button
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-4)',
          width: '100%',
          padding: 'var(--space-3) var(--space-3) var(--space-3) 0',
          background: isHovered ? 'var(--color-surface-2)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background var(--duration-fast) var(--ease-out)',
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            background: 'var(--color-surface-3)',
            flexShrink: 0,
          }}
        >
          {track.artworkUrl && (
            <CachedImage
              src={track.artworkUrl}
              alt={`${track.title} artwork`}
              loading="lazy"
              width={80}
              height={80}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              lineHeight: 1.3,
              // Two-line clamp on the title so very long episode names
              // don't push the description out of the row's height.
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {track.title}
          </div>
          {metaParts.length > 0 && (
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-tertiary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {metaParts.join(' · ')}
            </div>
          )}
          {track.description && (
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
                margin: 0,
                lineHeight: 1.5,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {track.description}
            </p>
          )}
        </div>
      </button>
    </ContextMenuTarget>
  );
};
