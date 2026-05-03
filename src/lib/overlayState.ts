import { createContext, useContext } from 'react';

/**
 * Read-only signal exposing which top-level overlays are currently
 * open. Provided at the App level so deeply-nested page components
 * (e.g. `DetailPageHero`'s portaled back button) can react without
 * prop-drilling. CSS-only `:has()` rules + body classes proved
 * unreliable in WKWebView; this is the deterministic React-driven
 * source of truth.
 */
export interface OverlayState {
  nowPlayingOpen: boolean;
  focusTimerOpen: boolean;
}

export const OverlayStateContext = createContext<OverlayState>({
  nowPlayingOpen: false,
  focusTimerOpen: false,
});

export const useOverlayState = (): OverlayState =>
  useContext(OverlayStateContext);
