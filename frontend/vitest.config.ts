import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/services/offline-store.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
  },
});
