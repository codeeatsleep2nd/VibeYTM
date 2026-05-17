import { type FC, useEffect, useRef, useState } from 'react';
import { ytmApi } from '../../lib/ipc';
import { useTauriEvent } from '../../hooks/useTauriEvent';

interface LoginPageProps {
  onLoggedIn: () => void;
}

export const LoginPage: FC<LoginPageProps> = ({ onLoggedIn }) => {
  const [error, setError] = useState<string | null>(null);

  // Latch so repeated events (the poller re-emits on each value transition)
  // only trigger the handoff once.
  const handedOffRef = useRef(false);

  const autoAdvance = () => {
    if (handedOffRef.current) return;
    handedOffRef.current = true;
    ytmApi.hideYtm().catch(() => {
      // If hiding fails, proceed anyway — the user can close it manually.
    });
    onLoggedIn();
  };

  useTauriEvent<boolean>('player:login-changed', (isLoggedIn) => {
    if (isLoggedIn) autoAdvance();
  });

  // The YTM window is created hidden at startup to avoid flashing on an
  // already-signed-in session (issue #51). If we landed on the LoginPage,
  // the user needs to see that window to authenticate — surface it.
  useEffect(() => {
    ytmApi.showYtm().catch(() => {
      // If showing fails, the user can still click the "Show YouTube Music
      // window" button below as a manual recovery path.
    });
    // Also nudge the bridge to re-check quickly so a user who is already
    // signed in (returning user) isn't forced to wait for the next poll cycle.
    ytmApi.injectBridge().catch(() => {
      // Bridge was already injected via Tauri init script — safe to ignore.
    });
  }, []);

  const handleShowYtm = async () => {
    setError(null);
    try {
      await ytmApi.showYtm();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not open YouTube Music window: ${msg}`);
    }
  };

  const handleDone = async () => {
    try {
      await ytmApi.hideYtm();
    } catch {
      // ignore
    }
    onLoggedIn();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 'var(--space-5)',
        padding: 'var(--space-8)',
      }}
    >
      <div style={{ fontSize: '48px', marginBottom: 'var(--space-2)' }}>
        🎵
      </div>

      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
          letterSpacing: '-0.02em',
        }}
      >
        Welcome to VibeYTM
      </h1>

      <p
        style={{
          fontSize: 'var(--text-base)',
          color: 'var(--color-text-secondary)',
          textAlign: 'center',
          maxWidth: '420px',
          lineHeight: 1.6,
        }}
      >
        A YouTube Music window should have opened alongside this one.
        Sign in with your Google account there, then come back here.
      </p>

      {error && (
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: '#f44',
            textAlign: 'center',
            maxWidth: '400px',
            padding: 'var(--space-3)',
            background: 'rgba(255,68,68,0.1)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {error}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-2)',
        }}
      >
        <button
          onClick={handleDone}
          style={{
            padding: 'var(--space-3) var(--space-8)',
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            color: 'white',
            background: 'var(--color-accent)',
            border: 'none',
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            transition: 'opacity var(--duration-fast)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.9';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          I'm signed in — let's go
        </button>

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
          }}
        >
          <button
            onClick={handleShowYtm}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-tertiary)',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Show YouTube Music window
          </button>

          <button
            onClick={onLoggedIn}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-tertiary)',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
};
