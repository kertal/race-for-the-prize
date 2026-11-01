import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['races/**', 'my-races/**', 'integration/**', 'node_modules/**'],
  },
});
