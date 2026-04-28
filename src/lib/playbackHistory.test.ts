import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_ENTRIES,
  pushHistoryEntry,
  type HistoryEntry,
} from './playbackHistory';
import type { TrackInfo } from './types';

// Pure helper — no DOM, no localStorage. Pin the LRU + cap rules so a
// future "naïve append" regression can't ship empty re-plays or grow
// the log unbounded.

const baseTrack = (videoId: string): TrackInfo => ({
  videoId,
  title: `Track ${videoId}`,
  artist: 'Artist',
  album: 'Album',
  durationSecs: 180,
});

const entry = (videoId: string, playedAt: number): HistoryEntry => ({
  track: baseTrack(videoId),
  playedAt,
});

describe('pushHistoryEntry', () => {
  it('puts the new entry at index 0 (most recent first)', () => {
    const e1 = entry('a', 1);
    const e2 = entry('b', 2);
    const next = pushHistoryEntry([e1], e2);
    expect(next.map((e) => e.track.videoId)).toEqual(['b', 'a']);
  });

  it('moves an existing videoId to the front instead of duplicating', () => {
    const list = [entry('a', 3), entry('b', 2), entry('c', 1)];
    const next = pushHistoryEntry(list, entry('c', 4));
    expect(next.map((e) => e.track.videoId)).toEqual(['c', 'a', 'b']);
    expect(next[0].playedAt).toBe(4);
  });

  it('drops entries beyond MAX_HISTORY_ENTRIES from the tail', () => {
    const big = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, i) =>
      entry(`v${i}`, i),
    );
    const next = pushHistoryEntry(big, entry('new', 999));
    expect(next).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(next[0].track.videoId).toBe('new');
    // The oldest (lowest-index in original) survives — the cap drops
    // the tail of the LIST, which after the prepend is the previously
    // oldest entry. Verify the trim by checking the last element.
    expect(next[MAX_HISTORY_ENTRIES - 1].track.videoId).toBe(
      `v${MAX_HISTORY_ENTRIES - 2}`,
    );
  });

  it('rejects entries with empty videoId — they would collide as a single LRU bucket', () => {
    const list = [entry('a', 1)];
    const empty: HistoryEntry = {
      track: { ...baseTrack(''), videoId: '' },
      playedAt: 2,
    };
    const next = pushHistoryEntry(list, empty);
    expect(next).toEqual(list);
  });

  it('does not mutate the input list', () => {
    const list = [entry('a', 1)];
    const before = list.map((e) => e.track.videoId);
    pushHistoryEntry(list, entry('b', 2));
    expect(list.map((e) => e.track.videoId)).toEqual(before);
  });
});
