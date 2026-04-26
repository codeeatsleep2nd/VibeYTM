import { type FC, useEffect, useState } from 'react';
import { ArtworkPlaceholder } from '../../ArtworkPlaceholder';
import { CachedImage } from '../../CachedImage';
import type { TrackInfo } from '../../../lib/types';
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
  const chain = artworkChain(sourceTrack);
  const [chainIdx, setChainIdx] = useState(0);
  useEffect(() => {
    setChainIdx(0);
  }, [sourceTrack.videoId, sourceTrack.artworkUrl]);
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
