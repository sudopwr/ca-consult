import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@ca/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/composition-root.ts'],
      // §10.1 — domain and application are gated hard; infrastructure is
      // covered by integration tests, and chasing a number there produces
      // mock theatre.
      thresholds: {
        'src/domain/**/*.ts': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'src/application/**/*.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
});
