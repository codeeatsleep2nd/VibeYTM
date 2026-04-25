import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { debug, isDebugOn, setDebugOn } from './lib/debug';

// Window-level capture so even errors that escape React end up in
// the dev-server log (provided debug is on). We always console.log
// them too — that path needs WebView devtools but doesn't depend on
// the IPC bridge being healthy. Cheap when debug is off because the
// debug.* helpers short-circuit.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    debug.error('window.error', e.message, e.filename, `${e.lineno}:${e.colno}`, e.error?.stack);
    // Always print to console regardless of toggle so devtools sees it.
    // eslint-disable-next-line no-console
    console.error('[window.error]', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    debug.error('window.unhandledrejection', String(e.reason), (e.reason as Error)?.stack);
    // eslint-disable-next-line no-console
    console.error('[window.unhandledrejection]', e.reason);
  });
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-line-of-defense error boundary. Without this, an exception in
 * any component crashes the WHOLE React tree and the visible page
 * renders as the body's bare background — observed in prod as "UI
 * goes black after playing for a while." With this, the user sees a
 * minimal recovery screen and can reload, while the underlying
 * audio playback (which lives in a separate Rust process) keeps
 * going.
 */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // ALWAYS forward — these are the events we most need to see.
    // Force-enable debug for one session if it isn't already, so the
    // crash is captured by the IPC pipe regardless of prior state.
    if (!isDebugOn()) setDebugOn(true);
    debug.error(
      'react.errorBoundary',
      error.message,
      error.stack,
      info.componentStack,
    );
    // eslint-disable-next-line no-console
    console.error('[react.errorBoundary]', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '1rem',
            padding: '2rem',
            background: 'oklch(12% 0.005 270)',
            color: 'oklch(85% 0 0)',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
            textAlign: 'center',
            zIndex: 999,
          }}
        >
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
            VibeYTM hit an unexpected error
          </h1>
          <pre
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 12,
              opacity: 0.7,
              maxWidth: 720,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '0.5rem',
              padding: '0.6rem 1.4rem',
              background: 'oklch(62% 0.24 25)',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload UI
          </button>
          <p style={{ fontSize: 12, opacity: 0.5, margin: 0 }}>
            Audio is unaffected — the bridge keeps playing.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
