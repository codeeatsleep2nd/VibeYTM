import { describe, expect, it } from 'vitest';
import { reorderShelves } from './HomePage';
import type { Shelf } from '../../lib/types';

const stubItems: Shelf['items'] = { kind: 'Songs', data: [] };
const shelf = (title: string): Shelf => ({ title, items: stubItems });

describe('reorderShelves', () => {
  it('pins all three priority shelves in the configured order', () => {
    const input = [
      shelf('Quick picks'),
      shelf('Albums for you'),
      shelf('Trending community playlists'),
      shelf('Listen again'),
      shelf('Discovery'),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual([
      'Listen again',
      'Discovery',
      'Albums for you',
      'Quick picks',
      'Trending community playlists',
    ]);
  });

  it('matches any alias in a priority slot', () => {
    // YTM's real title is "Discovery" but users may call it "Daily discovery"
    // or "Your daily discovery" — all three should pin to the same slot.
    const inputs = [
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
    // If YTM ever returns two equivalent shelves (very unlikely), the first
    // wins the priority slot; the second falls through to rest.
    const input = [
      shelf('Discovery'),
      shelf('Daily discovery'),
      shelf('Quick picks'),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual(['Discovery', 'Daily discovery', 'Quick picks']);
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
      shelf('  discovery  '),
    ];
    const out = reorderShelves(input).map((s) => s.title);
    expect(out).toEqual([
      'LISTEN AGAIN',
      '  discovery  ',
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
