import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL auto-registers an afterEach(cleanup) only when Vitest globals are
// enabled. Our config keeps globals off (cleaner imports), so wire it
// up here once.
afterEach(() => {
  cleanup();
});
