import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['races/**', 'my-races/**', 'runner/**', 'integration/**', 'node_modules/**'],
  },
});
