import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReloadOverlay } from './LoadingOverlay';

// These tests exist specifically to lock in the two visual contracts of
// `ReloadOverlay` that have each been broken by a previous change:
//
//   1. The children must be visually BLURRED during refresh
//      (`filter: blur(10px)` + tiny scale-down). Removing this kills
//      the stale-while-revalidate cue and the page looks frozen.
//
//   2. The wrapper around the children must NOT set
//      `pointer-events: none`. That click-block is what made every
//      card on Home/Explore/Library/Search unclickable during YTM
//      bridge stalls. Only the spinner overlay layer is allowed to be
//      pointer-events: none.
//
// Both regressions have happened in production. If either contract
// breaks again, this suite fails — and it's allowed to be a string-
// match test because the styles are inline and the rendering is
// stable. We do NOT need a full DOM / Playwright run for this; the
// markup contains everything we need.

describe('ReloadOverlay visual contracts', () => {
  afterEach(() => {
    // No-op; renderToStaticMarkup leaves no global state behind.
  });

  it('renders the children INSIDE a wrapper with filter: blur(10px)', () => {
    const html = renderToStaticMarkup(
      <ReloadOverlay>
        <div data-testid="cached-content">Album cards go here</div>
      </ReloadOverlay>,
    );
    // The blur must be present somewhere in the rendered tree.
    expect(html).toMatch(/filter:\s*blur\(10px\)/);
    // And the children must actually be inside the blurred wrapper —
    // not outside or in a sibling node — so the blur applies to them.
    const blurMatch = html.match(/filter:\s*blur\(10px\)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    expect(blurMatch).not.toBeNull();
    expect(blurMatch![1]).toContain('Album cards go here');
  });

  it('NEVER sets pointer-events: none on the children-wrapping layer', () => {
    const html = renderToStaticMarkup(
      <ReloadOverlay>
        <button data-testid="card">Click me</button>
      </ReloadOverlay>,
    );
    // The blurred wrapper has the children. Extract that wrapper's
    // style attribute and assert it does NOT contain pointer-events: none.
    const wrapper = html.match(/<div\s+style="([^"]*filter:\s*blur\(10px\)[^"]*)"/);
    expect(wrapper).not.toBeNull();
    const wrapperStyle = wrapper![1];
    expect(wrapperStyle).not.toMatch(/pointer-events:\s*none/);
  });

  it('puts pointer-events: none ONLY on the spinner overlay layer', () => {
    const html = renderToStaticMarkup(
      <ReloadOverlay>
        <div>content</div>
      </ReloadOverlay>,
    );
    // There must be at least one occurrence of pointer-events: none
    // (the spinner overlay needs it so it doesn't intercept clicks).
    expect(html).toMatch(/pointer-events:\s*none/);
    // But it must NOT appear on the same div as the blur filter.
    const wrapper = html.match(/<div\s+style="([^"]*filter:\s*blur\(10px\)[^"]*)"/);
    expect(wrapper).not.toBeNull();
    expect(wrapper![1]).not.toMatch(/pointer-events:\s*none/);
  });

  it('NEVER applies a CSS transform to the children-wrapping layer', () => {
    // `transform: scale(...)` creates a stacking context that
    // WKWebView mishandles for hit-testing — clicks on some children
    // stop registering. An earlier attempt to add `scale(0.98)` to
    // hide the blur halo broke clicks across Home / Explore /
    // Library. The blur is enough on its own; transform is forbidden.
    const html = renderToStaticMarkup(
      <ReloadOverlay>
        <div>content</div>
      </ReloadOverlay>,
    );
    const wrapper = html.match(/<div\s+style="([^"]*filter:\s*blur\(10px\)[^"]*)"/);
    expect(wrapper).not.toBeNull();
    expect(wrapper![1]).not.toMatch(/transform\s*:/);
  });

  it('renders the spinner overlay (role="status") on top of the children', () => {
    const html = renderToStaticMarkup(
      <ReloadOverlay>
        <div>content</div>
      </ReloadOverlay>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
  });
});
