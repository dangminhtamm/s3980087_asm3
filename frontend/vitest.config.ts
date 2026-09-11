import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/features/offline-sync/conflict-policy.ts',
        'src/features/offline-sync/indexed-db.repository.ts',
        'src/features/offline-sync/sync-engine.ts',
        'src/features/proof-of-delivery/hooks/useDeliveryWorkflow.ts',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
  },
});
