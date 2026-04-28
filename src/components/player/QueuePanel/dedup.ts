import type { TrackInfo } from '../../../lib/types';

export function normalizeTitle(title: string | undefined): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[「」『』《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drop ANY repeat of the same videoId AND any later occurrence of a song
 * sharing a normalized title with one already in the list. YTM's radio
 * frequently sprinkles multiple recordings of the same song (different
 * artists' covers, lyric videos) — distinct videoIds but visually
 * indistinguishable. Keep only the first occurrence per (videoId | title).
 *
 * `seedCurrent` is the currently-playing track. Pre-seeding both its
 * videoId AND normalized title prevents the Up-Next list from opening
 * with a different recording of the same song the user is hearing.
 */
export function dedupeByVideoIdAndTitle(
  items: TrackInfo[],
  seedCurrent?: TrackInfo | null,
): TrackInfo[] {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  if (seedCurrent?.videoId) seenIds.add(seedCurrent.videoId);
  const seedTitle = normalizeTitle(seedCurrent?.title);
  if (seedTitle) seenTitles.add(seedTitle);
  const out: TrackInfo[] = [];
  for (const t of items) {
    if (t.videoId && seenIds.has(t.videoId)) continue;
    const titleKey = normalizeTitle(t.title);
    if (titleKey && seenTitles.has(titleKey)) continue;
    if (t.videoId) seenIds.add(t.videoId);
    if (titleKey) seenTitles.add(titleKey);
    out.push(t);
  }
  return out;
}
