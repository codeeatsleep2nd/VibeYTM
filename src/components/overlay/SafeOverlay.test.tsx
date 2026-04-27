import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeOverlay, useOverlayOpen } from './SafeOverlay';

// SafeOverlay locks down the four WKWebView click-loss invariants the
// app has shipped regressions for, in one primitive:
//
//   1. The wrapper's `pointer-events` is always AND-ed with `isOpen` —
//      a closed overlay never steals clicks from the page behind it.
//   2. The wrapper never applies `transform: scale(...)`. WKWebView
//      mishandles the stacking context this creates and clicks on
//      cards underneath stop registering. Only `translateY` is allowed
//      for the entrance animation.
//   3. Children that need their own `pointer-events: auto` get the
//      overlay's `isOpen` via `useOverlayOpen()` so they can AND
//      correctly. A child inside a closed overlay is never click-active.
//   4. The wrapper sets `aria-hidden` when closed, so screen readers
//      and tab navigation don't dive into a panel the user can't see.
//
// Each of these has caused a production regression. This suite is the
// regression net.

describe('SafeOverlay', () => {
  it('renders its children', () => {
    render(
      <SafeOverlay isOpen ariaLabel="test">
        <div>hello world</div>
      </SafeOverlay>,
    );
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('open: pointer-events on the wrapper is auto', () => {
    render(
      <SafeOverlay isOpen ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    const wrapper = screen.getByLabelText('test');
    expect(wrapper.style.pointerEvents).toBe('auto');
  });

  it('closed: pointer-events on the wrapper is none', () => {
    render(
      <SafeOverlay isOpen={false} ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    const wrapper = screen.getByLabelText('test');
    expect(wrapper.style.pointerEvents).toBe('none');
  });

  it('open: opacity is 1 and translateY is 0 (default rise-from-bottom)', () => {
    render(
      <SafeOverlay isOpen ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    const wrapper = screen.getByLabelText('test');
    expect(wrapper.style.opacity).toBe('1');
    expect(wrapper.style.transform).toMatch(/translateY\(0/);
  });

  it('closed: opacity is 0 and translateY is positive (default rise-from-bottom)', () => {
    render(
      <SafeOverlay isOpen={false} ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    const wrapper = screen.getByLabelText('test');
    expect(wrapper.style.opacity).toBe('0');
    expect(wrapper.style.transform).toMatch(/translateY\(\d+(\.\d+)?px\)/);
  });

  it('slideFrom=right: open=translateX(0), closed=translateX past the right inset', () => {
    const { rerender } = render(
      <SafeOverlay isOpen slideFrom="right" ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(screen.getByLabelText('test').style.transform).toMatch(/translateX\(0/);
    rerender(
      <SafeOverlay isOpen={false} slideFrom="right" ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    // Translation must move past the right inset to fully clear the
    // window edge (otherwise a sliver of the panel's left edge stays
    // visible when the drawer is meant to be hidden).
    expect(screen.getByLabelText('test').style.transform).toMatch(
      /translateX\(calc\(100% \+ /,
    );
  });

  it('slideFrom=right: closed opacity drops to 0 so the panel is fully hidden', () => {
    const { rerender } = render(
      <SafeOverlay isOpen slideFrom="right" ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(screen.getByLabelText('test').style.opacity).toBe('1');
    rerender(
      <SafeOverlay isOpen={false} slideFrom="right" ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(screen.getByLabelText('test').style.opacity).toBe('0');
  });

  it('NEVER applies transform: scale on the wrapper', () => {
    const { container, rerender } = render(
      <SafeOverlay isOpen ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(container.innerHTML).not.toMatch(/scale\(/);
    rerender(
      <SafeOverlay isOpen={false} ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(container.innerHTML).not.toMatch(/scale\(/);
  });

  it('slideFrom=right: NEVER applies transform: scale either', () => {
    const { container, rerender } = render(
      <SafeOverlay isOpen slideFrom="right" ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(container.innerHTML).not.toMatch(/scale\(/);
    rerender(
      <SafeOverlay isOpen={false} slideFrom="right" ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(container.innerHTML).not.toMatch(/scale\(/);
  });

  it('aria-hidden flips with isOpen', () => {
    const { rerender } = render(
      <SafeOverlay isOpen ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(screen.getByLabelText('test').getAttribute('aria-hidden')).toBe('false');
    rerender(
      <SafeOverlay isOpen={false} ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    expect(screen.getByLabelText('test').getAttribute('aria-hidden')).toBe('true');
  });

  it('useOverlayOpen returns false outside any provider', () => {
    let observed: boolean | null = null;
    const Probe = () => {
      observed = useOverlayOpen();
      return null;
    };
    render(<Probe />);
    expect(observed).toBe(false);
  });

  it('useOverlayOpen reflects parent SafeOverlay isOpen', () => {
    let observedOpen: boolean | null = null;
    let observedClosed: boolean | null = null;
    const Probe = ({ slot }: { slot: 'open' | 'closed' }) => {
      const v = useOverlayOpen();
      if (slot === 'open') observedOpen = v;
      else observedClosed = v;
      return null;
    };
    render(
      <>
        <SafeOverlay isOpen ariaLabel="open-overlay">
          <Probe slot="open" />
        </SafeOverlay>
        <SafeOverlay isOpen={false} ariaLabel="closed-overlay">
          <Probe slot="closed" />
        </SafeOverlay>
      </>,
    );
    expect(observedOpen).toBe(true);
    expect(observedClosed).toBe(false);
  });

  it('passes inset overrides to the wrapper position', () => {
    render(
      <SafeOverlay
        isOpen
        ariaLabel="test"
        inset={{ top: '0px', left: '0px', right: '0px', bottom: '0px' }}
      >
        <div>content</div>
      </SafeOverlay>,
    );
    const wrapper = screen.getByLabelText('test');
    expect(wrapper.style.top).toBe('0px');
    expect(wrapper.style.left).toBe('0px');
    expect(wrapper.style.right).toBe('0px');
    expect(wrapper.style.bottom).toBe('0px');
    expect(wrapper.style.position).toBe('fixed');
  });
});
