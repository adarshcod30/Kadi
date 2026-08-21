import { defineConfig } from 'vitest/config';

// jsdom so component tests can render; setup registers jest-dom matchers.
export default defineConfig({
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/__tests__/setup.ts'] },
});
