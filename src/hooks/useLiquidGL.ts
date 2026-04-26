import { useEffect, useRef } from 'react';

/**
 * Initialise liquidGL (vendored at /public/scripts/liquidGL.js) once
 * the document and the target selector are ready. liquidGL itself is
 * a process-wide singleton: a single shared WebGL renderer manages
 * every glass pane on the page, so this hook is idempotent — second
 * and later calls add new panes to the same renderer without spawning
 * a new GL context.
 *
 * Defensive bail-outs:
 *   1. SSR / jsdom (no window) — no-op.
 *   2. Library scripts haven't loaded yet — poll for up to 5 s before
 *      giving up. The two `<script defer>` tags in index.html resolve
 *      after the React bundle on a typical Tauri boot, so the poll
 *      window covers the race.
 *   3. WebGL unavailable on the runtime canvas — no-op, leaves the
 *      target's CSS backdrop-filter visible as the fallback.
 *
 * The hook does NOT tear down the lens on unmount — liquidGL exposes
 * no removal API. Acceptable for our use case because every consumer
 * (PlayerChrome, QueuePanel) mounts once for the app's lifetime; the
 * glass pane lives as long as the app does.
 */

interface LiquidGLOptions {
  target: string;
  snapshot?: string;
  resolution?: number;
  refraction?: number;
  bevelDepth?: number;
  bevelWidth?: number;
  frost?: number;
  shadow?: boolean;
  specular?: boolean;
  reveal?: 'none' | 'fade';
  tilt?: boolean;
  tiltFactor?: number;
  magnify?: number;
}

declare global {
  interface Window {
    liquidGL?: (opts: LiquidGLOptions) => unknown;
    html2canvas?: unknown;
  }
}

const POLL_INTERVAL_MS = 80;
const POLL_DEADLINE_MS = 5000;

function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}

export function useLiquidGL(options: LiquidGLOptions, enabled: boolean): void {
  // Guard against re-init for the same selector across React re-renders.
  // liquidGL is global, so once we've registered a selector it stays
  // managed. A second call for the same selector would attach a second
  // pane to the same DOM node, double-rendering the refraction.
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (initializedRef.current) return;
    if (typeof window === 'undefined') return;
    if (!webglAvailable()) return;

    let cancelled = false;
    const start = Date.now();

    const tick = () => {
      if (cancelled) return;
      const w = window;
      if (typeof w.liquidGL === 'function' && w.html2canvas) {
        // Confirm the target is in the DOM before init — liquidGL's
        // querySelectorAll runs once at call time and silently no-ops
        // for absent targets.
        if (document.querySelector(options.target)) {
          try {
            w.liquidGL(options);
            initializedRef.current = true;
          } catch (e) {
            console.warn('[liquidGL] init failed', e);
          }
          return;
        }
      }
      if (Date.now() - start > POLL_DEADLINE_MS) {
        // Fall through silently. CSS backdrop-filter is the visual
        // fallback on the same target, so the user just sees the
        // pre-WebGL look.
        return;
      }
      window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
