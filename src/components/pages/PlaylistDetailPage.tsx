import { type FC, useEffect, useState } from 'react';
import type { PlaylistDetail } from '../../lib/types';
import { browseApi, playerApi } from '../../lib/ipc';
import { debug } from '../../lib/debug';
import { rememberTrackArtworks } from '../../lib/trackArtworkRegistry';
import { rememberShowCover } from '../../lib/showCoverRegistry';
import { rememberTrackMetas } from '../../lib/trackMetaRegistry';
import { useCoverColors } from '../../hooks/useCoverColors';
import { albumArtOrNothing } from '../../lib/artwork';
import { SongRow } from '../browse/SongRow';
import { EpisodeRow } from '../browse/EpisodeRow';
import { LoadingSpinner } from '../LoadingOverlay';
import { DetailPageHero } from '../DetailPageHero';
import { SkeletonDetailHero, SkeletonRow } from '../Skeleton';

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
  // Show / podcast browseId — drives the "Show" kind label on the
  // hero and the "X episodes" meta line. Kaset's reference uses
  // MPSPP (5 chars) for podcast shows; matching that exactly so the
  // gate doesn't accidentally fire on any unrelated MPSP* prefix.
  // Save block stays hidden — YTM's podcast subscribe endpoint is a
  // different library surface we don't round-trip yet.
  const isShow = playlistId.startsWith('MPSPP');
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
      const surface = isShow ? 'Subscriptions' : isAlbum ? 'Albums' : 'Playlists';
      setSaveError(
        next ? `Could not save to ${surface}` : `Could not remove from ${surface}`,
      );
      debug.error('PlaylistDetailPage', 'save toggle failed', e);
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
        // Show / podcast cover side-channel — keyed by MPSP browseId so
        // the now-playing Cover can pick up the show's channel art for
        // any episode of this show, regardless of what host YTM serves
        // it from. The strict per-track artwork registry above drops
        // covers on hosts outside `lh*|yt3.googleusercontent.com`.
        rememberShowCover(playlistId, data.artworkUrl);
        // Per-track title + artist side-channel — recovers podcast
        // queue rows whose `.song-title` / `.byline` DOM scrape comes
        // back empty because YTM uses a different element shape for
        // episode list items. The Rust parser (`parse_episode_from_
        // multi_row`) populates these correctly, so caching them here
        // gives `<QueueRow>` a reliable fallback.
        rememberTrackMetas(data.tracks);
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

  // Drives the cover-tinted gradient behind the hero. MUST be called
  // before any early returns so React's hook-call order stays
  // identical across all render branches (loading / error / empty /
  // loaded). Was previously declared after the early returns and
  // tripped React's "rendered more hooks than the previous render"
  // invariant when `playlist` flipped from null → loaded.
  const heroColors = useCoverColors(
    albumArtOrNothing(playlist?.artworkUrl) ?? undefined,
  );

  // PlaylistDetailPage resets `playlist` to null before each fetch, so there
  // is no stale content to blur mid-load — keep the plain spinner here.
  if (isLoading) {
    // Skeleton scaffold matching the eventual hero + track-list layout
    // so the swap on data arrival doesn't shift the page. Falls back
    // to a plain spinner if the user has prefers-reduced-motion via
    // the Skeleton primitive's own check.
    return (
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          height: '100%',
        }}
      >
        <SkeletonDetailHero />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '0 var(--space-6) var(--space-8)',
          }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </section>
    );
  }
  // LoadingSpinner kept available for indeterminate cases that don't
  // benefit from a layout-mirroring skeleton.
  void LoadingSpinner;

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

  // Derived hero metadata: primary artist (album case → tracks share
  // an artist; playlist case → "Various artists" once we see > 1
  // distinct name) and total runtime summed across track durations.
  // Both are pure-frontend computations from the existing tracks
  // payload — no Rust parser change needed.
  const primaryArtist = (() => {
    if (isShow) return undefined;
    // Header-credited artist wins — albums often omit the per-track
    // artist field since the header carries it. Falls back to the
    // distinct set of per-track artists for playlists / mixes.
    if (playlist.artist) return playlist.artist;
    if (playlist.tracks.length === 0) return undefined;
    const distinct = new Set<string>();
    for (const t of playlist.tracks) {
      if (t.artist) distinct.add(t.artist);
      if (distinct.size > 1) break;
    }
    if (distinct.size === 0) return undefined;
    if (distinct.size === 1) return playlist.tracks.find((t) => t.artist)?.artist;
    return 'Various artists';
  })();
  const totalRuntimeSecs = playlist.tracks.reduce(
    (acc, t) => acc + (t.durationSecs > 0 ? t.durationSecs : 0),
    0,
  );
  const formatRuntime = (secs: number): string => {
    const total = Math.round(secs);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0) return `${hours} hr ${minutes} min`;
    return `${minutes} min`;
  };
  // Artist is hoisted into its own subtitle line (DetailPageHero
  // `artist` prop) so it reads with prominence instead of vanishing
  // into the small gray meta string.
  const metaParts: string[] = [];
  if (playlist.year) metaParts.push(playlist.year);
  if (playlist.trackCount !== undefined) {
    metaParts.push(`${playlist.trackCount} ${isShow ? 'episodes' : 'songs'}`);
  }
  if (totalRuntimeSecs > 0) metaParts.push(formatRuntime(totalRuntimeSecs));
  const heroMeta = metaParts.length > 0 ? metaParts.join(' · ') : undefined;

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      {/* Sticky hero — same chrome as ArtistPage. Cover/title/meta/
          actions stay pinned at the top of the page while the track
          list scrolls underneath. Transparent background +
          backdrop-filter blur so scrolled rows show through with a
          frosted-glass effect. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          flexShrink: 0,
          background: 'transparent',
          backdropFilter: 'var(--page-sticky-blur)',
          WebkitBackdropFilter: 'var(--page-sticky-blur)',
        }}
      >
        <DetailPageHero
          title={playlist.title}
          kind={isShow ? 'Show' : isAlbum ? 'Album' : 'Playlist'}
          coverUrl={playlist.artworkUrl ?? ''}
          colors={heroColors}
          artist={primaryArtist}
          meta={heroMeta}
          description={playlist.description ?? undefined}
          onBack={onBack}
          onPlay={handlePlayAll}
          save={{
            isSaved,
            isAlbum,
            isShow,
            isSaving,
            onToggle: toggleSaved,
            error: saveError,
          }}
          transparent
        />
      </div>

      {/* Track list. The wrapper shares the hero's left margin
          (space-6) so the row's outer edge — and the hover/selection
          background that paints to that edge — aligns with the hero
          cover image's left. The row's own internal padding stays
          inside that edge as breathing room for the row's content. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '0 var(--space-6)',
        }}
      >
        {playlist.tracks.map((track, i) =>
          isShow ? (
            <EpisodeRow
              key={track.videoId || `track-${i}`}
              track={track}
              playlistId={watchListId}
            />
          ) : (
            <SongRow
              key={track.videoId || `track-${i}`}
              track={track}
              index={i + 1}
              playlistId={watchListId}
            />
          ),
        )}
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
      {/* Invisible spacer so the last song row clears the floating
          player chrome. WebKit's `overflow: auto` excludes
          paddingBottom from `scrollHeight`, so the spacer must be a
          real DOM child to extend the scrollable area. */}
      <div
        aria-hidden="true"
        style={{
          flexShrink: 0,
          height: 'calc(var(--player-bar-height) + var(--space-3) * 2)',
        }}
      />
    </section>
  );
};
