import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Surface init progress to the dev-server terminal. Unconditional in
// dev so we can verify the WebGL pane actually attaches inside
// WKWebView (where browser devtools aren't readily available). The
// build optimiser tree-shakes both branches in production.
function diag(msg: string): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.log('[liquidGL]', msg);
  void invoke('debug_log', {
    level: 'log',
    message: `[liquidGL] ${msg}`,
  }).catch(() => {});
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

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
    if (!webglAvailable()) {
      diag('WebGL unavailable — falling back to CSS glass');
      return;
    }

    // Pipe any liquidGL/html2canvas console errors to the dev-server
    // log. Without this, snapshot failures vanish into the WKWebView
    // console (no devtools access in Tauri dev).
    if (import.meta.env.DEV) {
      const origError = console.error;
      console.error = (...args: unknown[]) => {
        const joined = args
          .map((a) =>
            typeof a === 'string'
              ? a
              : a instanceof Error
                ? `${a.name}: ${a.message}`
                : safeJson(a),
          )
          .join(' ');
        if (/liquid|html2canvas|snapshot/i.test(joined)) {
          diag(`console.error: ${joined.slice(0, 400)}`);
        }
        origError.apply(console, args);
      };
    }

    let cancelled = false;
    const start = Date.now();

    const tick = () => {
      if (cancelled) return;
      const w = window;
      if (typeof w.liquidGL === 'function' && w.html2canvas) {
        const targets = document.querySelectorAll(options.target);
        if (targets.length > 0) {
          try {
            const lensRef = w.liquidGL(options) as
              | { renderer?: { texture?: unknown; lenses?: unknown[] } }
              | { length: number; [k: number]: { renderer?: { texture?: unknown; lenses?: unknown[] } } }
              | undefined;
            initializedRef.current = true;
            diag(
              `attached: target='${options.target}' nodes=${targets.length}`,
            );
            const firstLens = (() => {
              if (!lensRef) return undefined;
              if (Array.isArray(lensRef)) return lensRef[0];
              if ('length' in lensRef && typeof lensRef.length === 'number')
                return (lensRef as { [k: number]: unknown })[0] as { renderer?: { texture?: unknown; lenses?: unknown[] } };
              return lensRef as { renderer?: { texture?: unknown; lenses?: unknown[] } };
            })();
            // Once the snapshot texture is uploaded, clear the lens
            // panes' CSS glass fallback so the WebGL canvas painted
            // behind them (z = lensZ - 1, sitting under the footer's
            // own stacking context) is no longer occluded by the
            // fallback bg. Until that point, the fallback IS the
            // visible chrome surface — so the user never sees a
            // transparent flash before liquidGL attaches.
            const promoteToWebGL = (): void => {
              document.querySelectorAll(options.target).forEach((node) => {
                const el = node as HTMLElement;
                el.style.background = 'transparent';
                el.style.backdropFilter = 'none';
                (el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = 'none';
              });
            };
            const checkTextureReady = (deadline: number): void => {
              const renderer = (
                firstLens as
                  | {
                      renderer?: { texture?: unknown; lenses?: unknown[] };
                    }
                  | undefined
              )?.renderer;
              if (renderer?.texture) {
                promoteToWebGL();
                const canvas = document.querySelector(
                  'canvas[data-liquid-ignore]',
                ) as HTMLCanvasElement | null;
                diag(
                  `texture loaded — promoted ${
                    document.querySelectorAll(options.target).length
                  } panes to WebGL refraction; canvas opacity=${
                    canvas?.style.opacity ?? '?'
                  }`,
                );
                return;
              }
              if (Date.now() > deadline) {
                diag(
                  'texture never loaded within 8 s — keeping CSS glass fallback visible',
                );
                return;
              }
              window.setTimeout(() => checkTextureReady(deadline), 200);
            };
            checkTextureReady(Date.now() + 8000);
          } catch (e) {
            diag(`init threw: ${(e as Error).message}`);
          }
          return;
        }
      }
      if (Date.now() - start > POLL_DEADLINE_MS) {
        diag(
          `timed out waiting for scripts/target: liquidGL=${typeof w.liquidGL} html2canvas=${typeof w.html2canvas} target='${options.target}'`,
        );
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
