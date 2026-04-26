import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiquidGL } from './useLiquidGL';

afterEach(() => {
  // Clear any spied-in liquidGL stub so each test starts clean.
  delete (window as unknown as Record<string, unknown>).liquidGL;
  delete (window as unknown as Record<string, unknown>).html2canvas;
});

describe('useLiquidGL', () => {
  it('does nothing when enabled=false', () => {
    const liquid = vi.fn();
    window.liquidGL = liquid as unknown as typeof window.liquidGL;
    window.html2canvas = {} as unknown;
    renderHook(() => useLiquidGL({ target: '.x' }, false));
    expect(liquid).not.toHaveBeenCalled();
  });

  it('does nothing in jsdom when WebGL is unavailable', () => {
    // jsdom returns null from canvas.getContext('webgl'), so the
    // hook should bail out without attempting init.
    const liquid = vi.fn();
    window.liquidGL = liquid as unknown as typeof window.liquidGL;
    window.html2canvas = {} as unknown;
    renderHook(() => useLiquidGL({ target: '.x' }, true));
    expect(liquid).not.toHaveBeenCalled();
  });

  it('does not throw when liquidGL global is missing', () => {
    expect(() =>
      renderHook(() => useLiquidGL({ target: '.x' }, true)),
    ).not.toThrow();
  });
});
