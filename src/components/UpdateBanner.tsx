import { type FC, useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTauriEvent } from '../hooks/useTauriEvent';
import { updateApi, type UpdateInfo } from '../lib/ipc';

const DISMISS_KEY = 'vibeytm:update-dismissed-version';

function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissedVersion(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    // localStorage unavailable (private mode etc.) — best-effort only.
  }
}

/**
 * Slim toast that appears when the Rust updater detects a newer GitHub
 * release. Re-emerges per launch unless the user has explicitly dismissed
 * the *same* version. A bumped release resurfaces the banner.
 */
export const UpdateBanner: FC = () => {
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  // The Rust updater fires its first GitHub check inside `setup`, often
  // before React has mounted and registered the event listener — so the
  // first event can land in the void. Pulling on mount catches that case;
  // the event listener still wires up the 12 h re-check.
  useEffect(() => {
    let cancelled = false;
    updateApi
      .check()
      .then((payload) => {
        if (cancelled) return;
        if (!payload.updateAvailable) return;
        if (readDismissedVersion() === payload.latestVersion) return;
        setInfo(payload);
      })
      .catch((e) => console.error('updateApi.check failed', e));
    return () => {
      cancelled = true;
    };
  }, []);

  useTauriEvent<UpdateInfo>('update-available', (payload) => {
    if (!payload.updateAvailable) return;
    if (readDismissedVersion() === payload.latestVersion) return;
    setInfo(payload);
  });

  if (!info) return null;

  const handleOpen = () => {
    openUrl(info.releaseUrl).catch((e) => console.error('open release url failed', e));
  };

  const handleDismiss = () => {
    writeDismissedVersion(info.latestVersion);
    setInfo(null);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'calc(var(--player-bar-height, 88px) + var(--space-4))',
        right: 'var(--space-4)',
        zIndex: 1000,
        maxWidth: '380px',
        background: 'var(--color-surface-2, oklch(20% 0 0))',
        border: '1px solid oklch(100% 0 0 / 0.1)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        boxShadow: '0 12px 32px oklch(0% 0 0 / 0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
        }}
      >
        Update available
      </div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          lineHeight: 1.4,
        }}
      >
        VibeYTM {info.latestVersion} is out — you're on {info.currentVersion}.
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-1)',
        }}
      >
        <button
          onClick={handleOpen}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            background: 'var(--color-accent)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-3)',
            cursor: 'pointer',
          }}
        >
          View release
        </button>
        <button
          onClick={handleDismiss}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
            background: 'transparent',
            border: '1px solid oklch(100% 0 0 / 0.12)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-3)',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
