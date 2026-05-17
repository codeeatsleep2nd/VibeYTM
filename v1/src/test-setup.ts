import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL auto-registers an afterEach(cleanup) only when Vitest globals are
// enabled. Our config keeps globals off (cleaner imports), so wire it
// up here once.
afterEach(() => {
  cleanup();
});

// `@liquidglass/react`'s package.json declares `type: module` but its
// `main` (dist/index.js) is plain CJS — Vitest can't resolve it. The
// component renders an SVG filter + wrapped div; for tests we only
// need a passthrough so PlayerChrome / page imports work.
vi.mock('@liquidglass/react', () => ({
  LiquidGlass: ({ children, ...rest }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-mock-liquidglass': true, ...rest }, children),
}));
