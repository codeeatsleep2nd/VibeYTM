import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton, SkeletonRow, SkeletonCard } from './Skeleton';

// Reduced-motion is read once via window.matchMedia at module init
// time — the helper hook below lets each test set a deterministic
// reply before the component mounts.
function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => mockReducedMotion(false));
afterEach(() => vi.restoreAllMocks());

describe('Skeleton', () => {
  it('renders with the given width and height', () => {
    const { container } = render(<Skeleton width={120} height={40} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('40px');
  });

  it('accepts string dimensions verbatim', () => {
    const { container } = render(<Skeleton width="50%" height="2rem" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('50%');
    expect(el.style.height).toBe('2rem');
  });

  it('applies the given border-radius', () => {
    const { container } = render(<Skeleton width={20} height={20} radius={8} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.borderRadius).toBe('8px');
  });

  it('uses aspect-ratio when provided (width set, height auto)', () => {
    const { container } = render(<Skeleton width={100} aspect={1} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.aspectRatio).toBe('1');
  });

  it('animates by default (shimmer overlay rendered)', () => {
    const { container } = render(<Skeleton width={50} height={50} />);
    // The shimmer is a child element with `animation` set inline. Look
    // for any descendant with animation in its style.
    const animated = container.querySelectorAll('[style*="animation"]');
    expect(animated.length).toBeGreaterThan(0);
  });

  it('omits the shimmer when prefers-reduced-motion is set', () => {
    mockReducedMotion(true);
    const { container } = render(<Skeleton width={50} height={50} />);
    const animated = container.querySelectorAll('[style*="animation"]');
    expect(animated.length).toBe(0);
  });

  it('NEVER applies transform: scale (WKWebView hit-test rule)', () => {
    const { container } = render(<Skeleton width={50} height={50} />);
    expect(container.innerHTML).not.toMatch(/scale\(/);
  });

  it('uses compositor-friendly transform animation, not background-position', () => {
    const { container } = render(<Skeleton width={50} height={50} />);
    // The shimmer must be transform-based per web/coding-style.md.
    // background-position animation triggers paint on every frame.
    expect(container.innerHTML).not.toMatch(/animation:[^"]*background-position/);
  });
});

describe('SkeletonRow', () => {
  it('renders three layered children: number, cover, text', () => {
    const { container } = render(<SkeletonRow />);
    // Outer flex row + 3 children matching SongRow layout
    const flexRow = container.querySelector('[style*="display: flex"]') as HTMLElement;
    expect(flexRow).not.toBeNull();
    expect(flexRow.children.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SkeletonCard', () => {
  it('renders a square cover stub plus a title stub', () => {
    const { container } = render(<SkeletonCard />);
    // Card has at least 2 skeleton elements (cover + title).
    const skeletons = container.querySelectorAll(
      '[style*="background"]',
    );
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  it('respects a custom size prop', () => {
    const { container } = render(<SkeletonCard size={200} />);
    const cover = container.querySelector(
      '[style*="aspect-ratio: 1"]',
    ) as HTMLElement | null;
    expect(cover).not.toBeNull();
    expect(cover!.style.width).toBe('200px');
  });
});
