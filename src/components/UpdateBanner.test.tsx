import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Node 25 ships a stub `localStorage` that lacks the Storage methods,
// and jsdom's window.localStorage doesn't propagate to globalThis here.
// Match the pattern used by `persistentCache.test.ts` so the dismiss-
// version persistence is tested against a real Storage shape.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

vi.stubGlobal('localStorage', new MemoryStorage());

import type { UpdateInfo } from '../lib/ipc';
const { UpdateBanner } = await import('./UpdateBanner');

// The banner pulls the first check on mount via `updateApi.check` and
// listens for live `update-available` events from the Rust updater
// every 12 h. Both paths feed the same dismiss-version filter — these
// tests pin the four cases the PR #63 review flagged as untested
// (issue #71): cold show, dismissed-suppress, newer-resurface, dismiss-
// click persistence.

const checkMock = vi.fn();
const openUrlMock = vi.fn().mockResolvedValue(undefined);
let lastUpdateAvailableHandler: ((p: UpdateInfo) => void) | null = null;

vi.mock('../lib/ipc', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    updateApi: {
      check: () => checkMock(),
    },
  };
});

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...a: unknown[]) => openUrlMock(...a),
}));

vi.mock('../hooks/useTauriEvent', () => ({
  useTauriEvent: <T,>(name: string, handler: (p: T) => void) => {
    if (name === 'update-available') {
      lastUpdateAvailableHandler = handler as unknown as (p: UpdateInfo) => void;
    }
  },
}));

const DISMISS_KEY = 'vibeytm:update-dismissed-version';

const baseInfo: UpdateInfo = {
  currentVersion: '1.1.4',
  latestVersion: '1.2.0',
  releaseUrl: 'https://github.com/example/release/v1.2.0',
  releaseNotes: 'Notes',
  updateAvailable: true,
};

beforeEach(() => {
  localStorage.clear();
  checkMock.mockReset();
  openUrlMock.mockClear();
  lastUpdateAvailableHandler = null;
});

afterEach(() => {
  localStorage.clear();
});

describe('UpdateBanner — dismiss-version persistence (issue #71)', () => {
  it('renders when updateApi.check returns updateAvailable and no dismissed version', async () => {
    checkMock.mockResolvedValue(baseInfo);
    render(<UpdateBanner />);
    await waitFor(() =>
      expect(screen.getByText(/Update available/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument();
  });

  it('does NOT render when localStorage holds the same latestVersion (suppressed)', async () => {
    localStorage.setItem(DISMISS_KEY, '1.2.0');
    checkMock.mockResolvedValue(baseInfo);
    render(<UpdateBanner />);
    // Wait for the async check to settle, then assert nothing showed.
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Update available/i)).not.toBeInTheDocument();
  });

  it('does render when an event delivers a NEWER version than the dismissed one', async () => {
    localStorage.setItem(DISMISS_KEY, '0.9.9');
    // Cold check returns no-update so the on-mount path does nothing.
    checkMock.mockResolvedValue({
      ...baseInfo,
      latestVersion: '0.9.9',
      updateAvailable: false,
    });
    render(<UpdateBanner />);
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Update available/i)).not.toBeInTheDocument();
    // Now simulate a fresh release event with a newer tag — banner
    // should resurface because dismissed='0.9.9' !== '1.2.0'.
    expect(lastUpdateAvailableHandler).not.toBeNull();
    lastUpdateAvailableHandler!(baseInfo);
    await waitFor(() =>
      expect(screen.getByText(/Update available/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument();
  });

  it('clicking Dismiss writes latestVersion to localStorage and unmounts the toast', async () => {
    checkMock.mockResolvedValue(baseInfo);
    render(<UpdateBanner />);
    await waitFor(() =>
      expect(screen.getByText(/Update available/i)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1.2.0');
    expect(screen.queryByText(/Update available/i)).not.toBeInTheDocument();
  });

  it('clicking View release forwards releaseUrl to the system opener', async () => {
    checkMock.mockResolvedValue(baseInfo);
    render(<UpdateBanner />);
    await waitFor(() =>
      expect(screen.getByText(/Update available/i)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: /View release/i }));
    expect(openUrlMock).toHaveBeenCalledWith(baseInfo.releaseUrl);
  });
});
