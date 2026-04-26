import { type FC, useEffect, useState } from 'react';
import type { PlaylistDetail } from '../../lib/types';
import { browseApi, playerApi } from '../../lib/ipc';
import { rememberTrackArtworks } from '../../lib/trackArtworkRegistry';
import { useCoverColors } from '../../hooks/useCoverColors';
import { albumArtOrNothing } from '../../lib/artwork';
import { SongRow } from '../browse/SongRow';
import { LoadingSpinner } from '../LoadingOverlay';
import { DetailPageHero } from '../DetailPageHero';

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

  // Drives the cover-tinted gradient behind the hero. The hook returns
  // a deep neutral fallback while the canvas-based palette extraction
  // settles, so the page is never colorless.
  const heroColors = useCoverColors(
    albumArtOrNothing(playlist.artworkUrl) ?? undefined,
  );

  // Same playlist-context resolution the action handlers need. Album
  // browseIds (MPRE) save through their underlying audioPlaylistId
  // (OLAK*) — see the toggleSaved invariants at the top of the file.
  const isAlbumBrowseId = playlistId.startsWith('MPRE');
  const watchListId =
    isAlbumBrowseId && playlist.audioPlaylistId
      ? playlist.audioPlaylistId
      : playlistId;

  const handlePlayAll = () => {
    if (playlist.tracks.length === 0) return;
    const firstId = playlist.tracks[0].videoId;
    if (!firstId) return;
    playerApi.playTrack(firstId, watchListId).catch(() => {});
  };

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <DetailPageHero
        title={playlist.title}
        kind={isAlbum ? 'Album' : 'Playlist'}
        coverUrl={playlist.artworkUrl ?? ''}
        colors={heroColors}
        meta={
          playlist.trackCount !== undefined
            ? `${playlist.trackCount} songs`
            : undefined
        }
        description={playlist.description ?? undefined}
        onBack={onBack}
        onPlay={handlePlayAll}
        save={{
          isSaved,
          isAlbum,
          isSaving,
          onToggle: toggleSaved,
          error: saveError,
        }}
      />

      {/* Track list */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '0 var(--space-6) var(--space-8)' }}>
        {playlist.tracks.map((track, i) => (
          <SongRow
            key={track.videoId || `track-${i}`}
            track={track}
            index={i + 1}
            playlistId={watchListId}
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
