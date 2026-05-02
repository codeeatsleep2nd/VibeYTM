import { describe, expect, it } from 'vitest';
import { reorderShelves } from './HomePage';
import type { Shelf } from '../../lib/types';

const stubItems: Shelf['items'] = { kind: 'Songs', data: [] };
const shelf = (title: string): Shelf => ({ title, items: stubItems });

describe('reorderShelves', () => {
  it('pins all three priority shelves in the configured order', () => {
    // Real YTM titles for this user's home — verified via API dumps.
    const input = [
      shelf('Albums for you'),
      shelf('Quick picks'),
      shelf('Mixed for you'),
      shelf('Forgotten favorites'),
      shelf('Trending community playlists'),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual([
      'Forgotten favorites',
      'Mixed for you',
      'Albums for you',
      'Quick picks',
      'Trending community playlists',
    ]);
  });

  it('matches any alias in a priority slot', () => {
    // Slot 1 ("Mixed for you") accepts the user-facing names too, in case
    // YTM ever rebrands the shelf back to "Daily discovery" / "Discovery".
    const inputs = [
      [shelf('Mixed for you'), shelf('Albums for you')],
      [shelf('Discovery'), shelf('Albums for you')],
      [shelf('Daily discovery'), shelf('Albums for you')],
      [shelf('Your daily discovery'), shelf('Albums for you')],
    ];
    for (const input of inputs) {
      const out = reorderShelves(input).map((s) => s.title);
      expect(out[0]).toBe(input[0].title);
      expect(out[1]).toBe('Albums for you');
    }
  });

  it('pins the first matching alias and sends later aliases to rest', () => {
    // If YTM ever returns two shelves whose titles both match the same slot,
    // the first wins; the second falls through to rest.
    const input = [
      shelf('Mixed for you'),
      shelf('Discovery'),
      shelf('Quick picks'),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual(['Mixed for you', 'Discovery', 'Quick picks']);
  });

  it('keeps non-priority shelves in their original backend order', () => {
    const input = [shelf('A'), shelf('B'), shelf('Forgotten favorites'), shelf('C')];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual(['Forgotten favorites', 'A', 'B', 'C']);
  });

  it('falls through gracefully when priority shelves are missing', () => {
    const input = [shelf('Quick picks'), shelf('Forgotten favorites')];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual(['Forgotten favorites', 'Quick picks']);
  });

  it('matches case-insensitively and tolerates trailing whitespace', () => {
    const input = [
      shelf('quick picks'),
      shelf('  Albums For You  '),
      shelf('FORGOTTEN FAVORITES'),
      shelf('  mixed for you  '),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual([
      'FORGOTTEN FAVORITES',
      '  mixed for you  ',
      '  Albums For You  ',
      'quick picks',
    ]);
  });

  it('does not mutate input array', () => {
    const input = [shelf('A'), shelf('Forgotten favorites')];
    const snapshot = input.map((s) => s.title);
    reorderShelves(input);
    expect(input.map((s) => s.title)).toEqual(snapshot);
  });

  it('dedupes when the same priority title appears twice', () => {
    const input = [
      shelf('Forgotten favorites'),
      shelf('Quick picks'),
      shelf('Forgotten favorites'),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    // First occurrence wins; the duplicate falls into rest, preserving its position
    expect(out).toEqual(['Forgotten favorites', 'Quick picks', 'Forgotten favorites']);
  });

  it('returns a new array (no identity reuse)', () => {
    const input = [shelf('A'), shelf('B')];
    const out = reorderShelves(input);
    expect(out).not.toBe(input);
  });

  it('handles empty input', () => {
    expect(reorderShelves([])).toEqual([]);
  });
});
