import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts on purpose: `npm run test`/`npx vitest run`
// must never be able to reach a real provider. This config is only ever
// invoked via `npm run test:e2e -- --provider <name>` (scripts/run-e2e.mjs),
// which sets E2E_PROVIDER and picks the matching suite file.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Real requestUrl shim, not the vi.fn() mock tests/setup.ts installs —
    // E2E suites need actual network calls to reach the provisioned provider.
    alias: {
      'obsidian': './e2e/shim/obsidian-request-url.ts',
    },
    include: ['e2e/suites/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Provisioning spins up one container per provider; running suites in
    // parallel workers would multiply that for no benefit at this scale.
    fileParallelism: false,
  },
});
