import { type FC, useEffect, useRef, useState } from 'react';
import { ytmApi } from '../../lib/ipc';
import { useTauriEvent } from '../../hooks/useTauriEvent';

interface LoginPageProps {
  onLoggedIn: () => void;
}

/**
 * Mirrors kaset's LoginSheet flow (sozercan/kaset, Sources/Kaset/Views/
 * LoginSheet.swift): when the login surface mounts, the auxiliary YTM
 * window navigates straight to Google's sign-in URL and becomes visible.
 * The user signs in there; the bridge poller detects __VIBEYTM_LOGGED_IN__,
 * emits `player:login-changed: true`, and the boot orchestrator flips
 * `phase` to `app` — at which point App.tsx hides the YTM window
 * automatically (see App.tsx auto-hide effect). The "I'm already signed
 * in" and "Skip for now" buttons remain as manual recovery paths.
 */
export const LoginPage: FC<LoginPageProps> = ({ onLoggedIn }) => {
  const [error, setError] = useState<string | null>(null);

  // Latch so repeated events (the poller re-emits on each value transition)
  // only trigger the handoff once.
  const handedOffRef = useRef(false);

  const autoAdvance = () => {
    if (handedOffRef.current) return;
    handedOffRef.current = true;
    ytmApi.hideYtm().catch(() => {
      // App.tsx also hides on phase=app; this is belt-and-suspenders.
    });
    onLoggedIn();
  };

  useTauriEvent<boolean>('player:login-changed', (isLoggedIn) => {
    if (isLoggedIn) autoAdvance();
  });

  // Auto-open the sign-in surface on mount — matches kaset's sheet, which
  // embeds the login WebView directly. Gated by a ref so React StrictMode's
  // dev-mode double-invocation doesn't fire the cross-origin navigation
  // twice (which makes the YTM WebView hard-reload, visible as a flicker).
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    // Order: openSignIn first (kicks off the cross-origin nav), showYtm
    // second (so the user never sees a flash of music.youtube.com before
    // Google takes over), injectBridge last (queues against the post-
    // redirect-back page when sign-in completes).
    ytmApi.openSignIn().catch(() => {
      // Fallback: stay on whatever URL the YTM window has. The "Reopen
      // sign-in page" button below is the manual recovery path.
    });
    ytmApi.showYtm().catch(() => {
      // Window-not-found is non-fatal — manual recovery via the button.
    });
    ytmApi.injectBridge().catch(() => {
      // Bridge was already injected via Tauri init script — safe to ignore.
    });
  }, []);

  const handleReopenSignIn = async () => {
    setError(null);
    try {
      await ytmApi.openSignIn();
      await ytmApi.showYtm();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not open the sign-in page: ${msg}`);
    }
  };

  const handleAlreadySignedIn = async () => {
    try {
      await ytmApi.hideYtm();
    } catch {
      // ignore
    }
    onLoggedIn();
  };

  const handleSkip = async () => {
    // The YTM window may still be on accounts.google.com from the
    // earlier auto-open. The bridge's `ytm_api_call` requires a
    // music.youtube.com origin to fetch /youtubei/v1/... — without
    // navigating back, every browse/search call hangs cross-origin.
    try {
      await ytmApi.navigateToHome();
      await ytmApi.hideYtm();
    } catch {
      // Non-fatal; user will land on AppShell either way.
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
        Sign in to YouTube Music
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
        Sign in with your Google account in the window that just opened.
        We'll bring you back here automatically once you're signed in.
      </p>

      <p
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-tertiary)',
          textAlign: 'center',
          maxWidth: '420px',
          lineHeight: 1.6,
          marginTop: 'calc(-1 * var(--space-3))',
        }}
      >
        If passkeys don't work, use "Try another way" to sign in with a password.
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
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <button
            onClick={handleReopenSignIn}
            style={{
              padding: 'var(--space-3) var(--space-6)',
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
            Reopen sign-in page
          </button>

          <button
            onClick={handleAlreadySignedIn}
            style={{
              padding: 'var(--space-3) var(--space-6)',
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              transition: 'background var(--duration-fast), border-color var(--duration-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-surface-hover, rgba(255,255,255,0.06))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            I'm already signed in
          </button>
        </div>

        <button
          onClick={handleSkip}
          style={{
            padding: 'var(--space-1) var(--space-3)',
            marginTop: 'var(--space-1)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
};
