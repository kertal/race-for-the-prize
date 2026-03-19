import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.test.js'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
