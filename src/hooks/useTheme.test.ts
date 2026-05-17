import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  let listeners: Array<() => void>;
  let matchesValue: boolean;

  beforeEach(() => {
    listeners = [];
    matchesValue = false;

    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
      matches: matchesValue,
      addEventListener: (_event: string, handler: () => void) => {
        listeners.push(handler);
      },
      removeEventListener: (_event: string, handler: () => void) => {
        listeners = listeners.filter((l) => l !== handler);
      },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    vi.spyOn(document.documentElement, 'setAttribute');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets data-theme="dark" when mode is dark', () => {
    renderHook(() => useTheme('dark'));
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });

  it('sets data-theme="light" when mode is light', () => {
    renderHook(() => useTheme('light'));
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
  });

  it('resolves system to dark when matchMedia matches', () => {
    matchesValue = true;
    renderHook(() => useTheme('system'));
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });

  it('resolves system to light when matchMedia does not match', () => {
    matchesValue = false;
    renderHook(() => useTheme('system'));
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
  });

  it('listens to matchMedia changes and updates data-theme', () => {
    matchesValue = false;
    renderHook(() => useTheme('system'));
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');

    // Simulate system preference changing to dark
    matchesValue = true;
    listeners.forEach((l) => l());
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });

  it('writes resolved theme to localStorage', () => {
    // jsdom's localStorage is a custom object; spy on it directly via
    // Object.defineProperty so we can observe the setItem call.
    const calls: Array<[string, string]> = [];
    const original = window.localStorage;
    const store: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; calls.push([k, v]); },
        removeItem: (k: string) => { delete store[k]; },
      },
    });
    renderHook(() => useTheme('dark'));
    expect(calls).toContainEqual(['vibeytm:theme', 'dark']);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
  });

  it('cleans up matchMedia listener on unmount', () => {
    const { unmount } = renderHook(() => useTheme('system'));
    expect(listeners.length).toBe(1);
    unmount();
    expect(listeners.length).toBe(0);
  });
});
