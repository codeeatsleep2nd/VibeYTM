import { defineConfig } from 'vitest/config';

// Vitest config kept separate from `vite.config.ts` so the dev/build
// pipeline isn't pulled into the test runtime. jsdom gives us a real
// `localStorage` implementation for the persistentCache tests.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
