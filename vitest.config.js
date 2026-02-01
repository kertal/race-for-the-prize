import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['races/**', 'runner/**', 'node_modules/**'],
  },
});
