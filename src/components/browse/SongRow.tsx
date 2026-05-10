import { type CSSProperties, type FC, useState } from 'react';
import { ListMusic, Plus, Trash2 } from 'lucide-react';
import type { TrackInfo } from '../../lib/types';
import { playerApi } from '../../lib/ipc';
import { openAddToPlaylistPicker } from '../../lib/addToPlaylistRegistry';
import { CachedImage } from '../CachedImage';
import { MarqueeText } from '../MarqueeText';
import { ContextMenuTarget } from '../contextMenu/ContextMenu';
import { buildTrackContextMenu } from '../contextMenu/trackActions';

interface SongRowProps {
  track: TrackInfo;
  index?: number;
  onClick?: () => void;
  playlistId?: string;
  /** When provided, the row gains a hover-revealed Trash2 button next to
   *  the queue/playlist quick-actions. Caller is responsible for any
   *  confirmation UX and for refetching the playlist after success.
   *  Wired only by PlaylistDetailPage for user-editable playlists. */
  onRemoveFromPlaylist?: () => void;
}

const formatDuration = (secs: number): string => {
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const SongRow: FC<SongRowProps> = ({
  track,
  index,
  onClick,
  playlistId,
  onRemoveFromPlaylist,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (track.videoId) {
      playerApi.playTrack(track.videoId, playlistId).catch(() => {});
    }
  };

  return (
    <ContextMenuTarget buildSections={() => buildTrackContextMenu({ track })}>
    <button
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: '100%',
        // No paddingLeft — list rows align their content with the
        // parent container's content edge (matching the leftmost
        // visual element of the page, e.g., a hero cover image).
        // paddingRight stays so the duration column doesn't crowd
        // the row's right edge.
        padding: 'var(--space-2) var(--space-3) var(--space-2) 0',
        // Glass-tile hover (rim + thickness + lift) replaces the flat
        // `--color-surface-2` fill so the hovered row reads as a
        // discrete glass plate floating above the list. Tokens.css
        // owns the recipe — same as sidebar nav, mood pills, focus
        // chips, search category tabs.
        background: isHovered ? 'var(--glass-tile-bg-active)' : 'transparent',
        boxShadow: isHovered ? 'var(--glass-tile-shadow)' : undefined,
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        transition:
          'background var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
      }}
    >
      {index !== undefined && (
        <span
          style={{
            width: '24px',
            textAlign: 'right',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-tertiary)',
            flexShrink: 0,
          }}
        >
          {index}
        </span>
      )}

      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: 'var(--radius-sm)',
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
            width={40}
            height={40}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <MarqueeText
          text={track.title}
          hovered={isHovered}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
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
        </div>
      </div>

      {/* Hover-revealed inline action buttons. Apple Music / Spotify
          parity: track row exposes "Add to queue" + "Add to playlist"
          on the right when the row is hovered, so the user doesn't have
          to right-click for the most common saves.
          IMPORTANT: rendered as `<span role="button">` not `<button>` —
          the row itself is already a `<button>`, and WKWebView drops
          synthetic onClick events on nested-button HTML for the children
          (CLAUDE.md WKWebView quirks). The spans are still keyboard-
          focusable via tabIndex=0 + Enter/Space handler. */}
      <div
        aria-hidden={!isHovered}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          flexShrink: 0,
          opacity: isHovered ? 1 : 0,
          pointerEvents: isHovered ? 'auto' : 'none',
          transition: 'opacity var(--duration-fast) var(--ease-out)',
        }}
      >
        <InlineAction
          label="Add to queue"
          onActivate={() => {
            if (!track.videoId) return;
            playerApi.addToQueue(track).catch(() => {});
          }}
          icon={<ListMusic size={14} />}
        />
        <InlineAction
          label="Add to playlist"
          onActivate={(position) => {
            if (!track.videoId) return;
            openAddToPlaylistPicker({
              videoId: track.videoId,
              trackTitle: track.title,
              position: position ?? { x: 0, y: 0 },
            });
          }}
          icon={<Plus size={14} />}
        />
        {onRemoveFromPlaylist && (
          <InlineAction
            label="Remove from playlist"
            onActivate={() => onRemoveFromPlaylist()}
            icon={<Trash2 size={14} />}
            danger
          />
        )}
      </div>

      {track.durationSecs > 0 && (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            flexShrink: 0,
            minWidth: '36px',
            textAlign: 'right',
          }}
        >
          {formatDuration(track.durationSecs)}
        </span>
      )}
    </button>
    </ContextMenuTarget>
  );
};

// ---------------------------------------------------------------------------
// Inline action — span-as-button to avoid nested-<button> HTML in WKWebView.
// ---------------------------------------------------------------------------
interface InlineActionProps {
  label: string;
  onActivate: (position?: { x: number; y: number }) => void;
  icon: React.ReactNode;
  /** When true, hover state lights the icon in a destructive red instead
   *  of the default white. Used for the Trash2 remove-from-playlist
   *  affordance so the destructive intent reads at a glance. */
  danger?: boolean;
}

const InlineAction: FC<InlineActionProps> = ({
  label,
  onActivate,
  icon,
  danger,
}) => {
  const [hovered, setHovered] = useState(false);
  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 'var(--radius-full)',
    background: hovered
      ? danger
        ? 'oklch(62% 0.20 25 / 0.18)'
        : 'oklch(100% 0 0 / 0.10)'
      : 'transparent',
    color: hovered
      ? danger
        ? 'oklch(72% 0.18 25)'
        : 'var(--color-text-primary)'
      : 'var(--color-text-secondary)',
    cursor: 'pointer',
    transition:
      'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)',
    flexShrink: 0,
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(e) => {
        // Stop propagation so the parent row's onClick (which plays the
        // track) doesn't fire when the user just wants to queue / save.
        e.stopPropagation();
        onActivate({ x: e.clientX, y: e.clientY });
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onActivate({ x: rect.left, y: rect.bottom });
        }
      }}
      style={baseStyle}
    >
      {icon}
    </span>
  );
};
