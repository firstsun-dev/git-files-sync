#!/usr/bin/env node
/*
 * Entry point for `npm run test:e2e -- --provider <name>`. Vitest itself
 * doesn't understand `--provider`, so this parses it, sets E2E_PROVIDER,
 * and runs only that provider's suite file under vitest.e2e.config.ts.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const providerIndex = args.indexOf('--provider');
const provider = providerIndex !== -1 ? args[providerIndex + 1] : undefined;

if (!provider) {
    console.error('Usage: npm run test:e2e -- --provider <gitea>');
    process.exit(1);
}

const passthrough = args.filter((_, i) => i !== providerIndex && i !== providerIndex + 1);

const result = spawnSync(
    'npx',
    ['vitest', 'run', '-c', 'vitest.e2e.config.ts', `e2e/suites/${provider}.e2e.test.ts`, ...passthrough],
    {
        stdio: 'inherit',
        env: { ...process.env, E2E_PROVIDER: provider },
    }
);

process.exit(result.status ?? 1);
