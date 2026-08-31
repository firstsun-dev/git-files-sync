import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts on purpose: `npm run test`/`npx vitest run`
// must never be able to reach a real provider. This config is only ever
// invoked via `npm run test:e2e -- --provider <name>`, after
// `scripts/e2e-harness.sh provision` has resolved the run's isolated
// branch/container (E2E_WORKDIR) — see docs/testing/real-provider-e2e.md.
export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        // Real requestUrl shim, not the vi.fn() mock tests/setup.ts installs —
        // E2E suites need actual network calls to reach the provisioned provider.
        alias: {
            obsidian: './e2e-tests/provider/runtime/obsidian-request-url.ts',
        },
        // Minimal `window` alias so production code written for Obsidian's
        // Electron renderer (e.g. window.setTimeout) runs as-is under Node.
        setupFiles: ['./e2e-tests/provider/runtime/window-timers.ts'],
        include: ['e2e-tests/provider/suites/**/*.e2e.test.ts'],
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
