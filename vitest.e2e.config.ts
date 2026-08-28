import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts on purpose: `npm run test`/`npx vitest run`
// must never be able to reach a real provider. This config is only ever
// invoked via `npm run test:e2e -- --provider <name>`, after
// `scripts/e2e-harness.sh provision` has generated the vitest-only runtime
// adapters this points at (E2E_RUNTIME_DIR) — see
// docs/testing/real-provider-e2e.md. Those adapters are what use
// fetch/globalThis/node:child_process; keeping them generated-not-committed
// is what keeps this checked-in config (and the suites it runs) clean of the
// APIs the Obsidian scanner flags.
const runtimeDir = process.env.E2E_RUNTIME_DIR;

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        // Real requestUrl shim, not the vi.fn() mock tests/setup.ts installs —
        // E2E suites need actual network calls to reach the provisioned provider.
        alias: runtimeDir ? {
            obsidian: `${runtimeDir}/obsidian-request-url.ts`,
            '@e2e-runtime/git-verifier': `${runtimeDir}/verifier/git-verifier.ts`,
        } : {},
        // Minimal `window` alias so production code written for Obsidian's
        // Electron renderer (e.g. window.setTimeout) runs as-is under Node.
        setupFiles: runtimeDir ? [`${runtimeDir}/window-timers.ts`] : [],
        include: ['e2e/suites/**/*.e2e.test.ts'],
        exclude: ['**/node_modules/**', '**/.claude/**'],
        testTimeout: 120_000,
        hookTimeout: 120_000,
        // Real-provider suites run network round trips per test with nothing
        // printed until a whole file finishes under the default reporter —
        // in CI that reads as a hang. verbose prints each test as it
        // completes, so progress is visible while it's still running.
        reporters: ['verbose'],
        // Provisioning spins up one container per provider; running suites in
        // parallel workers would multiply that for no benefit at this scale.
        fileParallelism: false,
    },
});
