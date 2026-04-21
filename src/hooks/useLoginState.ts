import { useEffect, useState } from 'react';
import { playerApi } from '../lib/ipc';
import { useTauriEvent } from './useTauriEvent';

/**
 * Tri-state YTM sign-in status.
 *   null  = undetermined (bridge hasn't reported yet — show a loader)
 *   true  = signed in (skip the login gate)
 *   false = signed out (show the LoginPage)
 *
 * Seeded synchronously from the Rust-side PlayerState so an already-signed-in
 * user doesn't flash the login page on launch (issue #51).
 */
export function useLoginState(): boolean | null {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    playerApi
      .getLoginState()
      .then((state) => {
        if (!cancelled) setLoggedIn(state);
      })
      .catch(() => {
        // Backend not ready — leave as null and rely on the event stream.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useTauriEvent<boolean>('player:login-changed', (next) => {
    setLoggedIn(next);
  });

  return loggedIn;
}
