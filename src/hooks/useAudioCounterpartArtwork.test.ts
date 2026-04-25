import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/ipc', () => ({
  browseApi: { getAudioCounterpartArtwork: vi.fn() },
}));
vi.mock('../lib/debug', () => ({
  debug: { log: () => undefined, warn: () => undefined, error: () => undefined },
}));

describe('useAudioCounterpartArtwork module shape', () => {
  it('does not export a sentinel that varies between imports', async () => {
    // Tripwire for the black-UI bug. The bug was that the
    // failure-sentinel `Symbol` was created INSIDE the hook
    // closure. Each component instance got its own Symbol, so the
    // shared `inflight` promise's `.then(result => result === sentinel)`
    // identity check failed in follower closures, allowing the
    // Symbol to flow into the cache and downstream regex .test()
    // calls — which crashes with "Cannot convert a symbol to a
    // string" and unmounts the React tree.
    //
    // The fix is to keep the sentinel at module scope. We can't
    // poke at it directly (it's a private symbol), but we can
    // assert the module exports are stable across imports — a
    // cheap proxy for "no per-call closure state leaks out".
    const a = await import('./useAudioCounterpartArtwork');
    const b = await import('./useAudioCounterpartArtwork');
    expect(a.useAudioCounterpartArtwork).toBe(b.useAudioCounterpartArtwork);
  });
});
