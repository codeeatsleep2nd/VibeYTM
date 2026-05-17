import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Mock the login-state hook so we can drive boot transitions
// deterministically without needing the Tauri bridge.
let mockLoginState: boolean | null = null;
vi.mock('./useLoginState', () => ({
  useLoginState: () => mockLoginState,
}));

// Imported AFTER the mock above so the hook picks up the stub.
import { useBootState } from './useBootState';

describe('useBootState', () => {
  beforeEach(() => {
    mockLoginState = null;
  });

  it('starts in loading phase when login state is undetermined', () => {
    const { result } = renderHook(() => useBootState());
    expect(result.current.phase).toBe('loading');
    expect(result.current.isSplashDone).toBe(false);
  });

  it('transitions to login phase when bridge reports signed-out', () => {
    mockLoginState = false;
    const { result } = renderHook(() => useBootState());
    expect(result.current.phase).toBe('login');
    // LoginPage is up behind the splash — splash should fade.
    expect(result.current.isSplashDone).toBe(true);
  });

  it('transitions to app phase when bridge reports signed-in', () => {
    mockLoginState = true;
    const { result } = renderHook(() => useBootState());
    expect(result.current.phase).toBe('app');
    // AppShell is up but Home has not painted yet — splash stays.
    expect(result.current.isSplashDone).toBe(false);
  });

  it('app phase: splash stays until markHomeReady is called', () => {
    mockLoginState = true;
    const { result } = renderHook(() => useBootState());
    expect(result.current.isSplashDone).toBe(false);
    act(() => result.current.markHomeReady());
    expect(result.current.isSplashDone).toBe(true);
  });

  it('manual override skips into app phase even when bridge says signed-out', () => {
    mockLoginState = false;
    const { result } = renderHook(() => useBootState());
    expect(result.current.phase).toBe('login');
    act(() => result.current.markManualLogin());
    expect(result.current.phase).toBe('app');
  });

  it('manual override skips into app phase even when bridge is undetermined', () => {
    // The "Skip for now" affordance: user clicks it before the bridge
    // has reported anything. The override fires immediately and the
    // app starts loading shelves.
    mockLoginState = null;
    const { result } = renderHook(() => useBootState());
    expect(result.current.phase).toBe('loading');
    act(() => result.current.markManualLogin());
    expect(result.current.phase).toBe('app');
  });

  it('markHomeReady is idempotent', () => {
    mockLoginState = true;
    const { result } = renderHook(() => useBootState());
    act(() => result.current.markHomeReady());
    act(() => result.current.markHomeReady());
    expect(result.current.isSplashDone).toBe(true);
  });
});
