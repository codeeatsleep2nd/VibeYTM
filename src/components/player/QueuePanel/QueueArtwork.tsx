import { type FC, useEffect, useState } from 'react';
import { ArtworkPlaceholder } from '../../ArtworkPlaceholder';
import { CachedImage } from '../../CachedImage';
import type { TrackInfo } from '../../../lib/types';
import { usePlayerSelector } from '../../../hooks/usePlayerState';
import { useAudioCounterpartArtwork } from '../../../hooks/useAudioCounterpartArtwork';
import { BRIDGE_SETTLE_MS } from '../../../hooks/useBridgeSafeFetch';
import { lookupShowCover } from '../../../lib/showCoverRegistry';
import { isAlbumArtUrl } from '../../../lib/artwork';
import { artworkChain } from './artwork';

interface QueueArtworkProps {
  track: TrackInfo;
  /**
   * Optional override used by the now-playing row. When the queue's row
   * metadata came from a DOM scrape (signed thumbnail URL filtered out
   * by `artworkChain`), passing the live PlayerState track here lets
   * the row pull the same stable album-art URL the player bar shows,
   * keeping the two surfaces visually consistent.
   */
  liveTrack?: TrackInfo | null;
}

/**
 * Queue thumbnail with an album-art URL fallback chain. Routes through
 * `CachedImage` (Rust-side `cache_fetch_image` via reqwest) so the YT
 * CDN URLs sidestep the WKWebView referrer/CORS restrictions that
 * cause plain `<img>` loads of `i.ytimg.com` to silently fail in the
 * Tauri shell.
 *
 * The bridge often captures an empty (or signed/expiring) `artworkUrl`
 * for off-screen YTM queue rows; the chain falls back through the
 * canonical album-art variants so the row never goes blank.
 */
export const QueueArtwork: FC<QueueArtworkProps> = ({ track, liveTrack }) => {
  // Prefer the live PlayerState track's artworkUrl when it's available
  // and matches the queue row's videoId — that's the bar's source and
  // matches the now-playing page exactly. Falls through to the queue
  // row's own track if not provided or mismatched.
  const sourceTrack =
    liveTrack && liveTrack.videoId === track.videoId ? liveTrack : track;
  // Show / podcast context: every queue row is an episode of the same
  // show, so the show's channel cover (registered by
  // `PlaylistDetailPage`) is the right thumbnail for every row. Prepend
  // it to the chain so it wins over the (typically empty for podcasts)
  // strict album-art chain. Bypasses the album-art-only host filter
  // because the channel page renders the same URL via `<CachedImage>`
  // with no host check, so we trust it here too.
  //
  // Selector subscription (NOT the full `usePlayerState`): ~100 of these
  // rows stay mounted via SafeOverlay even when the queue is closed.
  // Subscribing to the whole player state would re-render every row on
  // every `player:position` tick — see `lib/playerStore.ts`.
  const activePlaylistId = usePlayerSelector((s) => s.activePlaylistId);
  const isPodcastContext = (activePlaylistId ?? '').startsWith('MPSP');
  const showCoverUrl = isPodcastContext
    ? lookupShowCover(activePlaylistId)
    : undefined;
  const baseChain = artworkChain(sourceTrack);
  // Issue #96 — when /next didn't return album-art for this row (UGC
  // tracks, song-radio rows missing their counterpart), lazily resolve
  // it via `useAudioCounterpartArtwork`. The hook is module-cached and
  // de-duped across rows, so opening the queue produces at most one
  // IPC per upcoming videoId we haven't seen, and zero on subsequent
  // re-mounts.
  //
  // Settle gating (#96 follow-up): the hook itself doesn't respect the
  // CLAUDE.md "background fetches need ~1.5-2 s after track-change"
  // rule. With a 10-row queue, opening the panel during a track change
  // would fan out 10 simultaneous getAudioCounterpartArtwork IPCs and
  // starve user-driven IPCs (get_playlist, search). We delay the hook
  // mount by `BRIDGE_SETTLE_MS` so the fan-out only fires once the
  // bridge has settled.
  const [readyForCounterpart, setReadyForCounterpart] = useState(false);
  useEffect(() => {
    setReadyForCounterpart(false);
    const t = setTimeout(() => setReadyForCounterpart(true), BRIDGE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [sourceTrack.videoId]);
  const counterpart = useAudioCounterpartArtwork(
    readyForCounterpart ? sourceTrack.videoId : undefined,
    sourceTrack.artworkUrl,
  );
  const counterpartChain =
    isAlbumArtUrl(counterpart) && !baseChain.includes(counterpart!)
      ? [counterpart!]
      : [];
  const chain = [
    ...(showCoverUrl ? [showCoverUrl] : []),
    ...baseChain,
    ...counterpartChain,
  ];
  const [chainIdx, setChainIdx] = useState(0);
  useEffect(() => {
    setChainIdx(0);
  }, [sourceTrack.videoId, sourceTrack.artworkUrl, showCoverUrl]);
  const src = chain[chainIdx];
  if (!src) return <ArtworkPlaceholder size={40} />;
  return (
    <CachedImage
      key={src}
      src={src}
      alt={track.title ? `${track.title} artwork` : ''}
      width={40}
      height={40}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onError={(e) => {
        const next = chainIdx + 1;
        if (next < chain.length) {
          setChainIdx(next);
        } else {
          e.currentTarget.style.display = 'none';
        }
      }}
    />
  );
};
