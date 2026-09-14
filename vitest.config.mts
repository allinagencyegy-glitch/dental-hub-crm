import path from 'node:path';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Vitest runs in plain Node, where `server-only` resolves to a module that
      // throws by design. Point it at the package's own no-op build instead.
      'server-only': path.resolve(process.cwd(), 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/foundation/**/*.test.ts'],
    globalSetup: ['tests/foundation/setup/global-setup.ts'],
    // One database, one server: the suite runs sequentially in a single process.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
