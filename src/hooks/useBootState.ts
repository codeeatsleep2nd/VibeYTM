import { useCallback, useState } from 'react';
import { useLoginState } from './useLoginState';

/**
 * Boot phase the app is currently in. Drives which surface renders and
 * whether the WelcomeScreen splash is still up. Replaces the three
 * intertwined flags `App.tsx` previously juggled (`loginState`,
 * `loginOverride`, `isHomeReady`).
 *
 *   loading — sign-in state hasn't reported yet; only the splash is on
 *             screen. Any other render here would either flash the
 *             LoginPage to a signed-in user (#51) or paint a "Loading…"
 *             placeholder to a signed-out user.
 *   login   — bridge confirmed signed-out (or signed-in is unknown but
 *             the user dismissed the splash via "Skip for now"). The
 *             LoginPage is up; the splash fades over it.
 *   app     — bridge confirmed signed-in. The full AppShell is up; the
 *             splash fades when the Home page reports first-paint
 *             readiness via `markHomeReady` (issue #56).
 */
export type BootPhase = 'loading' | 'login' | 'app';

export interface BootState {
  phase: BootPhase;
  /**
   * Whether the splash should report itself "done fading". Drives the
   * `WelcomeScreen.isDone` prop.
   *
   *   loading: false (splash is the only thing on screen)
   *   login:   true  (LoginPage is rendered behind a fading splash)
   *   app:     reflects whether `markHomeReady()` has been called
   */
  isSplashDone: boolean;
  /**
   * The Home page calls this once its first real paint is on screen so
   * the splash starts fading. No-op when not in `app` phase or when
   * already marked.
   */
  markHomeReady: () => void;
  /**
   * Used by the LoginPage's "Skip for now" affordance to manually
   * override into the app phase even though the bridge hasn't reported
   * sign-in. Idempotent.
   */
  markManualLogin: () => void;
}

/**
 * Single source of truth for boot orchestration. Returns the current
 * phase plus the two callbacks that progress it. Keep `App.tsx` thin —
 * route on `phase`, fade the splash on `isSplashDone`, forward
 * `markHomeReady` to Home.
 */
export function useBootState(): BootState {
  const loginState = useLoginState();
  const [manualLogin, setManualLogin] = useState(false);
  const [isHomeReady, setIsHomeReady] = useState(false);

  const isSignedIn = loginState === true || manualLogin;

  let phase: BootPhase;
  let isSplashDone: boolean;
  if (loginState === null && !manualLogin) {
    phase = 'loading';
    isSplashDone = false;
  } else if (!isSignedIn) {
    phase = 'login';
    // Once we know the user is signed out the LoginPage is ready behind
    // the splash — let it fade.
    isSplashDone = true;
  } else {
    phase = 'app';
    // Don't fade the splash until Home has actually painted, otherwise
    // the user sees the empty AppShell with a "Loading…" Home for a
    // beat. The Home page calls `markHomeReady()` once its first real
    // shelves are rendered.
    isSplashDone = isHomeReady;
  }

  const markHomeReady = useCallback(() => setIsHomeReady(true), []);
  const markManualLogin = useCallback(() => setManualLogin(true), []);

  return { phase, isSplashDone, markHomeReady, markManualLogin };
}
