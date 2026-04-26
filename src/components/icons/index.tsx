/**
 * Icon library — re-exports the subset of lucide-react icons that match
 * Apple Music's SF-Symbol-equivalent shapes used in PlayerChrome and
 * NowPlayingCard.
 *
 * Why a library and not hand-rolled SVG: SF Symbols ≠ Unicode codepoints,
 * and hand-drawn approximations drift from the real shapes (e.g. our
 * earlier `PrevIcon` had a vertical bar like ⏮ "skip to start" instead
 * of the pure double-triangle ⏪ "rewind" that Apple Music actually uses).
 * Lucide's stroke-icon family is the closest practical match to SF
 * Symbols' line-icon style and ships only the icons we import (tree-shaken).
 *
 * Mapping: SF Symbol → lucide name
 *   shuffle              → Shuffle
 *   backward.fill        → Rewind
 *   play.fill            → Play
 *   pause.fill           → Pause
 *   forward.fill         → FastForward
 *   repeat               → Repeat
 *   repeat.1             → Repeat1
 *   heart                → Heart
 *   text.bubble.fill     → MessageSquareText
 *   list.bullet          → ListMusic
 *   speaker.slash.fill   → VolumeX
 *   speaker.wave.1.fill  → Volume1
 *   speaker.wave.2.fill  → Volume2
 */
export {
  Shuffle as ShuffleIcon,
  Rewind as PrevIcon,
  Play as PlayIcon,
  Pause as PauseIcon,
  FastForward as NextIcon,
  Repeat as RepeatIcon,
  Repeat1 as RepeatOneIcon,
  Heart as HeartIcon,
  MessageSquareText as LyricsIcon,
  ListMusic as QueueIcon,
  VolumeX as SpeakerMuteIcon,
  Volume1 as SpeakerLowIcon,
  Volume2 as SpeakerHighIcon,
  // Sidebar nav icons (chosen to match Apple Music's library/playlist/etc. SF Symbols)
  House as HomeIcon,
  Search as SearchIcon,
  Compass as ExploreIcon,
  ListMusic as PlaylistsIcon,
  Music2 as SongsIcon,
  Disc3 as AlbumsIcon,
  Mic2 as ArtistsIcon,
  Settings as SettingsIcon,
  // Sidebar collapse toggle
  PanelLeftClose as SidebarCollapseIcon,
  PanelLeftOpen as SidebarExpandIcon,
} from 'lucide-react';

import { Heart } from 'lucide-react';
import { type FC, type SVGProps } from 'react';

// HeartFillIcon — lucide's Heart is outline-only; render it with `fill`
// matching `currentColor` so the parent's color token both fills and
// strokes it (the AM "liked" state).
export const HeartFillIcon: FC<SVGProps<SVGSVGElement> & { size?: number }> = (
  props,
) => <Heart {...props} fill="currentColor" />;
