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
      shelf('Your daily discover'),
      shelf('Listen again'),
      shelf('Trending community playlists'),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual([
      'Listen again',
      'Your daily discover',
      'Albums for you',
      'Quick picks',
      'Trending community playlists',
    ]);
  });

  it('matches any alias in a priority slot', () => {
    // Slot 1 accepts YTM's truncated "Your daily discover" plus longer
    // variants in case YTM stops truncating or renames the shelf.
    const inputs = [
      [shelf('Your daily discover'), shelf('Albums for you')],
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
      shelf('Your daily discover'),
      shelf('Discovery'),
      shelf('Quick picks'),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual(['Your daily discover', 'Discovery', 'Quick picks']);
  });

  it('keeps non-priority shelves in their original backend order', () => {
    const input = [shelf('A'), shelf('B'), shelf('Listen again'), shelf('C')];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual(['Listen again', 'A', 'B', 'C']);
  });

  it('falls through gracefully when priority shelves are missing', () => {
    const input = [shelf('Quick picks'), shelf('Listen again')];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual(['Listen again', 'Quick picks']);
  });

  it('matches case-insensitively and tolerates trailing whitespace', () => {
    const input = [
      shelf('quick picks'),
      shelf('  Albums For You  '),
      shelf('LISTEN AGAIN'),
      shelf('  your daily discover  '),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual([
      'LISTEN AGAIN',
      '  your daily discover  ',
      '  Albums For You  ',
      'quick picks',
    ]);
  });

  it('does not mutate input array', () => {
    const input = [shelf('A'), shelf('Listen again')];
    const snapshot = input.map((s) => s.title);
    reorderShelves(input);
    expect(input.map((s) => s.title)).toEqual(snapshot);
  });

  it('dedupes when the same priority title appears twice', () => {
    const input = [
      shelf('Listen again'),
      shelf('Quick picks'),
      shelf('Listen again'),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    // First occurrence wins; the duplicate falls into rest, preserving its position
    expect(out).toEqual(['Listen again', 'Quick picks', 'Listen again']);
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
