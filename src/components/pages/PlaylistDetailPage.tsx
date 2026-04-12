import { type FC, useEffect, useState } from 'react';
import type { PlaylistDetail } from '../../lib/types';
import { browseApi, playerApi } from '../../lib/ipc';
import { SongRow } from '../browse/SongRow';
import { CachedImage } from '../CachedImage';

interface PlaylistDetailPageProps {
  playlistId: string;
  autoPlay?: boolean;
  onBack: () => void;
}

export const PlaylistDetailPage: FC<PlaylistDetailPageProps> = ({
  playlistId,
  autoPlay = false,
  onBack,
}) => {
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPlaylist(null);

    // Fetch playlist and current player state in parallel
    Promise.all([
      browseApi.getPlaylist(playlistId),
      playerApi.getState().catch(() => null),
    ])
      .then(([data, currentState]) => {
        if (cancelled) return;
        setPlaylist(data);
        setIsLoading(false);

        if (autoPlay && data.tracks.length > 0 && data.tracks[0].videoId) {
          // Don't auto-play if the current song is already in this playlist
          const currentVideoId = currentState?.track?.videoId;
          const alreadyInPlaylist =
            currentVideoId &&
            data.tracks.some((t) => t.videoId === currentVideoId);

          if (!alreadyInPlaylist) {
            playerApi
              .playTrack(data.tracks[0].videoId, playlistId)
              .catch(() => {});
          }
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(typeof e === 'string' ? e : 'Failed to load playlist');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playlistId, autoPlay]);

  if (isLoading) {
    return (
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-text-tertiary)',
          fontSize: 'var(--text-base)',
        }}
      >
        Loading...
      </section>
    );
  }

  if (error) {
    return (
      <section
        style={{
          padding: 'var(--space-8) var(--space-6)',
          height: '100%',
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            padding: 'var(--space-1) 0',
            marginBottom: 'var(--space-4)',
          }}
        >
          &larr; Back
        </button>
        <p
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--text-base)',
            textAlign: 'center',
            padding: 'var(--space-8)',
          }}
        >
          {error}
        </p>
      </section>
    );
  }

  if (!playlist) {
    return null;
  }

  return (
    <section
      style={{
        padding: '0 var(--space-6) var(--space-8)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      {/* Sticky header: back button + cover + title */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--color-surface-1)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          paddingTop: 'var(--space-6)',
          paddingBottom: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}
      >
      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
          padding: 'var(--space-1) 0',
          marginBottom: 'var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
        }}
      >
        &larr; Back
      </button>

      {/* Header: artwork + info side-by-side, top-aligned */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: 'var(--space-5)',
          alignItems: 'start',
        }}
      >
        {/* Compact artwork */}
        <div
          style={{
            width: '160px',
            height: '160px',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            background: 'var(--color-surface-2)',
          }}
        >
          {playlist.artworkUrl && (
            <CachedImage
              src={playlist.artworkUrl}
              alt={playlist.title}
              width={160}
              height={160}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </div>

        {/* Info column — top-aligned with the cover */}
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            gap: 'var(--space-2)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {playlistId.startsWith('MPRE') ? 'Album' : 'Playlist'}
          </div>
          <h1
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
              margin: 0,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {playlist.title}
          </h1>
          {playlist.trackCount !== undefined && (
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {playlist.trackCount} songs
            </div>
          )}
          {playlist.description && (
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-tertiary)',
                margin: 0,
                lineHeight: 1.5,
                maxWidth: '500px',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {playlist.description}
            </p>
          )}
          {/* Play all button */}
          <button
            onClick={() => {
              if (playlist.tracks.length > 0 && playlist.tracks[0].videoId) {
                playerApi.playTrack(playlist.tracks[0].videoId, playlistId).catch(() => {});
              }
            }}
            style={{
              alignSelf: 'flex-start',
              marginTop: 'var(--space-2)',
              background: 'var(--color-accent)',
              border: 'none',
              borderRadius: 'var(--radius-full)',
              padding: 'var(--space-2) var(--space-5)',
              color: 'oklch(100% 0 0)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            &#x25B6; Play all
          </button>
        </div>
      </div>
      </div>

      {/* Track list */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {playlist.tracks.map((track, i) => (
          <SongRow
            key={track.videoId || `track-${i}`}
            track={track}
            index={i + 1}
            playlistId={playlistId}
          />
        ))}
        {playlist.tracks.length === 0 && (
          <div
            style={{
              color: 'var(--color-text-tertiary)',
              fontSize: 'var(--text-sm)',
              textAlign: 'center',
              padding: 'var(--space-6)',
            }}
          >
            No tracks found
          </div>
        )}
      </div>
    </section>
  );
};
