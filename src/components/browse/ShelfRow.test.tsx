import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShelfRow } from './ShelfRow';

// Visual-contract test for the section H2. The /plan-design-review
// redesign on 2026-05-09 bumped these values to give Home/Explore section
// headers display weight; without this test, a future inline-style
// adjustment could silently drop the H2 back to a generic 18px subhead
// and the regression wouldn't be caught until a human notices.
describe('ShelfRow', () => {
  it('renders the title in an h2 using the display-sm token at weight 700', () => {
    render(
      <ShelfRow title="Listen again">
        <div data-testid="content" />
      </ShelfRow>,
    );

    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Listen again',
    });

    // jsdom inline style serialization: var(--…) round-trips with the
    // surrounding spaces collapsed. Match on the substring so the test
    // doesn't break if a future edit reflows the inline style block.
    expect(heading.style.fontSize).toContain('--text-display-sm');
    expect(heading.style.fontWeight).toBe('700');
  });

  it('passes through children below the heading', () => {
    render(
      <ShelfRow title="Albums for you">
        <div data-testid="content">grid</div>
      </ShelfRow>,
    );

    expect(screen.getByTestId('content')).toBeDefined();
  });
});
