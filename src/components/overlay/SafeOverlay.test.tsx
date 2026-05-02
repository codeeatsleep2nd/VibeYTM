import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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

  it('closed: opacity is 0 and translateY pushes the panel below its inset rect', () => {
    render(
      <SafeOverlay isOpen={false} ariaLabel="test">
        <div>content</div>
      </SafeOverlay>,
    );
    const wrapper = screen.getByLabelText('test');
    expect(wrapper.style.opacity).toBe('0');
    // Full-height translate (100%) so the panel slides cleanly off the
    // bottom edge — both opening and closing read as a smooth motion,
    // not a 24 px lift + fade.
    expect(wrapper.style.transform).toMatch(/translateY\(100%\)/);
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

  describe('willChange lifecycle (issue #99 — stacked-blur flicker)', () => {
    // The wrapper's `will-change` is gated on a `transitioning` flag
    // that flips true on every isOpen change and back to false 480 ms
    // later. A permanent `will-change: opacity, transform` keeps
    // WKWebView's GPU layer for the overlay promoted forever; when
    // two SafeOverlays both with backdrop-filter stack in the same
    // screen region (NowPlaying + a drawer), that triggers a paint
    // feedback loop. Demoting after the transition settles breaks the
    // loop. These tests pin that lifecycle so a future edit can't
    // silently regress the fix.

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('promotes will-change while transitioning, demotes after settle', () => {
      render(
        <SafeOverlay isOpen ariaLabel="test">
          <div>content</div>
        </SafeOverlay>,
      );
      const wrapper = screen.getByLabelText('test');
      // Mount kicks the effect synchronously — wrapper is in the
      // transitioning state.
      expect(wrapper.style.willChange).toBe('opacity, transform');

      // Just under the 480 ms settle: still transitioning.
      act(() => {
        vi.advanceTimersByTime(479);
      });
      expect(wrapper.style.willChange).toBe('opacity, transform');

      // Past the settle: layer demotes.
      act(() => {
        vi.advanceTimersByTime(2);
      });
      expect(wrapper.style.willChange).toBe('auto');
    });

    it('flipping isOpen re-promotes will-change for the next animation', () => {
      const { rerender } = render(
        <SafeOverlay isOpen ariaLabel="test">
          <div>content</div>
        </SafeOverlay>,
      );
      const wrapper = screen.getByLabelText('test');

      // Settle the initial mount transition.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(wrapper.style.willChange).toBe('auto');

      // Close — the close transition needs willChange promoted again.
      rerender(
        <SafeOverlay isOpen={false} ariaLabel="test">
          <div>content</div>
        </SafeOverlay>,
      );
      expect(wrapper.style.willChange).toBe('opacity, transform');

      // Settle again.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(wrapper.style.willChange).toBe('auto');
    });

    it('rapid isOpen flips cancel the prior demote timer (no premature demote)', () => {
      const { rerender } = render(
        <SafeOverlay isOpen ariaLabel="test">
          <div>content</div>
        </SafeOverlay>,
      );
      const wrapper = screen.getByLabelText('test');
      expect(wrapper.style.willChange).toBe('opacity, transform');

      // Flip just before the prior timer would have fired.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      rerender(
        <SafeOverlay isOpen={false} ariaLabel="test">
          <div>content</div>
        </SafeOverlay>,
      );
      // The prior 480 ms timer must have been cancelled by the effect
      // cleanup; advancing past its original deadline must NOT demote.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // 500 ms total elapsed since mount — without cleanup, the first
      // timer would have fired at 480 ms and demoted. The fresh
      // transition started at 300 ms; it has 480 ms ahead of it.
      expect(wrapper.style.willChange).toBe('opacity, transform');

      // Settle the second transition.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(wrapper.style.willChange).toBe('auto');
    });
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
