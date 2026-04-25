import { type FC, useEffect, useState } from 'react';
import type { PlaylistDetail } from '../../lib/types';
import { browseApi, playerApi } from '../../lib/ipc';
import { rememberTrackArtworks } from '../../lib/trackArtworkRegistry';
import { SongRow } from '../browse/SongRow';
import { CachedImage } from '../CachedImage';
import { LoadingSpinner } from '../LoadingOverlay';

interface PlaylistDetailPageProps {
  playlistId: string;
  autoPlay?: boolean;
  onBack: () => void;
  /**
   * Fired after a successful save or remove so the parent can invalidate
   * any cached library data — otherwise a removed playlist still appears
   * in LibraryPage when the user clicks Back.
   */
  onLibraryChanged?: () => void;
}

export const PlaylistDetailPage: FC<PlaylistDetailPageProps> = ({
  playlistId,
  autoPlay = false,
  onBack,
  onLibraryChanged,
}) => {
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tri-state local view of whether the playlist is saved. Seeded from the
  // YTM response's header toggle-button state (issue #55), then kept
  // optimistic across user clicks.
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isAlbum = playlist?.isAlbum ?? playlistId.startsWith('MPRE');
  // Albums save via their underlying audioPlaylistId (OLAK*), not the MPRE
  // browseId. Fall back to playlistId when the backend didn't surface one.
  const saveTargetId = playlist?.audioPlaylistId || playlistId;

  const toggleSaved = async () => {
    if (isSaving) return;
    const next = !isSaved;
    setIsSaving(true);
    setSaveError(null);
    setIsSaved(next); // optimistic
    try {
      if (next) {
        await browseApi.savePlaylistToLibrary(saveTargetId);
      } else {
        await browseApi.removePlaylistFromLibrary(saveTargetId);
      }
      // Tell the parent so cached library/album lists rebuild before the
      // user clicks Back into them.
      onLibraryChanged?.();
    } catch (e: unknown) {
      // Roll back and surface the error so the user knows it didn't stick.
      setIsSaved(!next);
      setSaveError(
        next
          ? `Could not save to ${isAlbum ? 'Albums' : 'Playlists'}`
          : `Could not remove from ${isAlbum ? 'Albums' : 'Playlists'}`,
      );
      console.error('[PlaylistDetailPage] save toggle failed:', e);
    } finally {
      setIsSaving(false);
    }
  };

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
        // Stash every track's album-art URL into the cross-component
        // registry so the queue panel can show the right cover for
        // any of these tracks even when /next's response doesn't
        // surface them. Same flow for albums (MPRE browseIds also
        // route through getPlaylist).
        rememberTrackArtworks(data.tracks);
        setPlaylist(data);
        // Seed the saved-state from the server so the button renders the
        // correct label on first paint (issue #55). Without this the button
        // always starts as "Save to library" even for already-saved content.
        setIsSaved(data.isInLibrary ?? false);
        setIsLoading(false);

        if (autoPlay && data.tracks.length > 0 && data.tracks[0].videoId) {
          // Don't auto-play if the current song is already in this playlist
          const currentVideoId = currentState?.track?.videoId;
          const alreadyInPlaylist =
            currentVideoId &&
            data.tracks.some((t) => t.videoId === currentVideoId);

          if (!alreadyInPlaylist) {
            // Only albums (MPRE browseId) need the OLAK swap; for any other
            // playlist id (PL/OLAK/RDCLAK/LM) the input is already a valid
            // watch list and audioPlaylistId could be an unrelated radio.
            const isAlbumBrowseId = playlistId.startsWith('MPRE');
            const watchList =
              isAlbumBrowseId && data.audioPlaylistId
                ? data.audioPlaylistId
                : playlistId;
            playerApi
              .playTrack(data.tracks[0].videoId, watchList)
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

  // PlaylistDetailPage resets `playlist` to null before each fetch, so there
  // is no stale content to blur mid-load — keep the plain spinner here.
  if (isLoading) {
    return <LoadingSpinner />;
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

  // Shows ('Your shows' / 'Shows for You' on home) surface through the same
  // onOpenPlaylist callback as albums/playlists, but their browseIds don't
  // resolve to a track-bearing playlist. Detect the empty-shell response
  // (no title AND no tracks) and render a friendly coming-soon placeholder
  // instead of a confusing blank page.
  if (playlist.tracks.length === 0 && !playlist.title) {
    return (
      <section
        style={{
          padding: 'var(--space-6) var(--space-6) var(--space-8)',
          height: '100%',
          overflowY: 'auto',
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
            marginBottom: 'var(--space-6)',
          }}
        >
          &larr; Back
        </button>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            minHeight: '50vh',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Shows coming soon
          </div>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)',
              maxWidth: '360px',
              lineHeight: 1.5,
            }}
          >
            Podcast and show playback isn't available in VibeYTM yet.
            We're working on it.
          </p>
        </div>
      </section>
    );
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
          // Match the sidebar nav's top padding so the back button lines
          // up with the sidebar navigation (issue #59).
          paddingTop: 'var(--space-3)',
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
          {/* Action row: Play all + Save to library */}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
              marginTop: 'var(--space-2)',
            }}
          >
            <button
              onClick={() => {
                if (playlist.tracks.length > 0 && playlist.tracks[0].videoId) {
                  const isAlbumBrowseId = playlistId.startsWith('MPRE');
                  const watchList =
                    isAlbumBrowseId && playlist.audioPlaylistId
                      ? playlist.audioPlaylistId
                      : playlistId;
                  playerApi.playTrack(playlist.tracks[0].videoId, watchList).catch(() => {});
                }
              }}
              style={{
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
            <button
              onClick={toggleSaved}
              disabled={isSaving}
              aria-pressed={isSaved}
              aria-label={isSaved ? 'Remove from library' : 'Save to library'}
              style={{
                background: 'transparent',
                border: '1px solid oklch(100% 0 0 / 0.16)',
                borderRadius: 'var(--radius-full)',
                padding: 'var(--space-2) var(--space-4)',
                color: isSaved ? 'var(--color-accent)' : 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                cursor: isSaving ? 'progress' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaved
                ? '✓ Remove from Library'
                : `+ Save to ${isAlbum ? 'Albums' : 'Playlists'}`}
            </button>
          </div>
          {saveError && (
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: '#f44',
                marginTop: 'var(--space-1)',
              }}
            >
              {saveError}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Track list */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {playlist.tracks.map((track, i) => {
          const isAlbumBrowseId = playlistId.startsWith('MPRE');
          const rowPlaylistId =
            isAlbumBrowseId && playlist.audioPlaylistId
              ? playlist.audioPlaylistId
              : playlistId;
          return (
            <SongRow
              key={track.videoId || `track-${i}`}
              track={track}
              index={i + 1}
              playlistId={rowPlaylistId}
            />
          );
        })}
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
