import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  closeAddToPlaylistPicker,
  openAddToPlaylistPicker,
  useAddToPlaylistRequest,
  __resetAddToPlaylistRegistryForTests,
} from './addToPlaylistRegistry';

describe('addToPlaylistRegistry', () => {
  beforeEach(() => {
    __resetAddToPlaylistRegistryForTests();
  });

  it('starts with null state', () => {
    const { result } = renderHook(() => useAddToPlaylistRequest());
    expect(result.current).toBeNull();
  });

  it('open() sets state', () => {
    const { result } = renderHook(() => useAddToPlaylistRequest());
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'abc',
        trackTitle: 'Hello',
        position: { x: 100, y: 200 },
      });
    });
    expect(result.current).toEqual({
      videoId: 'abc',
      trackTitle: 'Hello',
      position: { x: 100, y: 200 },
    });
  });

  it('open() while already open replaces state (re-anchor on second right-click)', () => {
    const { result } = renderHook(() => useAddToPlaylistRequest());
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'first',
        trackTitle: 'First Track',
        position: { x: 50, y: 50 },
      });
    });
    expect(result.current?.videoId).toBe('first');
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'second',
        trackTitle: 'Second Track',
        position: { x: 250, y: 250 },
      });
    });
    expect(result.current?.videoId).toBe('second');
    expect(result.current?.position).toEqual({ x: 250, y: 250 });
  });

  it('close() clears state', () => {
    const { result } = renderHook(() => useAddToPlaylistRequest());
    act(() => {
      openAddToPlaylistPicker({
        videoId: 'abc',
        trackTitle: 'Hello',
        position: { x: 0, y: 0 },
      });
    });
    expect(result.current).not.toBeNull();
    act(() => {
      closeAddToPlaylistPicker();
    });
    expect(result.current).toBeNull();
  });

  it('close() while already closed is a safe no-op', () => {
    const { result } = renderHook(() => useAddToPlaylistRequest());
    expect(result.current).toBeNull();
    act(() => {
      closeAddToPlaylistPicker();
    });
    expect(result.current).toBeNull();
  });
});
