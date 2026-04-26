import type { TrackInfo } from '../../lib/types';
import { playerApi } from '../../lib/ipc';
import type { ContextMenuSection } from './ContextMenu';

interface BuildTrackContextMenuOpts {
  track: TrackInfo;
  /** When provided, exposes "Remove from queue" (only valid in queue rows). */
  onRemoveFromQueue?: () => void;
  /** When provided, exposes "Go to artist" → triggers a search for the
   *  track's artist via the host app's nav state. Hidden when the track
   *  has no artist field. */
  onGoToArtist?: (artist: string) => void;
}

/**
 * Build the standard track-row context menu. The same sections drive
 * every surface that exposes a track (queue rows, song rows, top
 * results, playlist tracks). Items are gated on what the surface can
 * actually do — `onRemoveFromQueue` is only passed by queue rows, etc.
 */
export function buildTrackContextMenu(
  opts: BuildTrackContextMenuOpts,
): ContextMenuSection[] {
  const { track, onRemoveFromQueue, onGoToArtist } = opts;

  const playSection: ContextMenuSection = {
    id: 'play',
    items: [
      {
        id: 'play-now',
        label: 'Play now',
        onActivate: () => {
          if (!track.videoId) return;
          void playerApi.playTrack(track.videoId).catch(() => {});
        },
        disabled: !track.videoId,
      },
      {
        id: 'add-to-queue',
        label: 'Add to queue',
        onActivate: () => {
          void playerApi.addToQueue(track).catch(() => {});
        },
        disabled: !track.videoId,
      },
    ],
  };

  const navSection: ContextMenuSection = {
    id: 'nav',
    items: [
      ...(onGoToArtist && track.artist
        ? [
            {
              id: 'go-to-artist',
              label: `Go to ${track.artist}`,
              onActivate: () => onGoToArtist(track.artist),
            },
          ]
        : []),
      {
        id: 'copy-link',
        label: 'Copy link',
        onActivate: () => {
          if (!track.videoId) return;
          const url = `https://music.youtube.com/watch?v=${track.videoId}`;
          void navigator.clipboard?.writeText(url).catch(() => {});
        },
        disabled: !track.videoId,
      },
    ],
  };

  const removeSection: ContextMenuSection | null = onRemoveFromQueue
    ? {
        id: 'remove',
        items: [
          {
            id: 'remove-from-queue',
            label: 'Remove from queue',
            destructive: true,
            onActivate: onRemoveFromQueue,
          },
        ],
      }
    : null;

  return [playSection, navSection, ...(removeSection ? [removeSection] : [])];
}
