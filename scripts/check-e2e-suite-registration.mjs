#!/usr/bin/env node
/*
 * Guards against the "fake green" failure mode: a new e2e/suites/*.e2e.test.ts
 * file that isn't wired into CI. The suite manifest has one source of truth —
 * scripts/e2e-suites.txt, consumed by scripts/run-e2e.sh (which CI calls). This
 * check fails (non-zero) when a suite file exists on disk but isn't registered
 * there, so adding a suite without registering it breaks CI instead of
 * silently passing.
 *
 * Rules:
 *  - Provider-specific suites (github/gitlab/gitea.e2e.test.ts) are covered by
 *    a manifest line containing ${provider}; they must NOT also need an
 *    explicit static line.
 *  - Every other e2e/suites/*.e2e.test.ts is a shared suite and MUST be listed
 *    explicitly in the manifest.
 *  - Every static manifest line must point to a file that exists (catches
 *    typos / deleted suites).
 *
 * Wired into `npm run lint` so both the husky pre-commit hook and CI enforce it.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const manifestPath = join(root, 'scripts', 'e2e-suites.txt');
const suitesDir = join(root, 'e2e', 'suites');

const PROVIDERS = ['github', 'gitlab', 'gitea'];

function readManifest() {
    const raw = readFileSync(manifestPath, 'utf-8');
    const lines = raw.split('\n').map(l => {
        const hash = l.indexOf('#');
        return (hash >= 0 ? l.slice(0, hash) : l).trim();
    });
    const staticSuites = [];
    let hasDynamic = false;
    for (const line of lines) {
        if (!line) continue;
        if (line.includes('${provider}')) {
            hasDynamic = true;
            continue;
        }
        staticSuites.push(line);
    }
    return { staticSuites, hasDynamic };
}

function listSuiteFiles() {
    return readdirSync(suitesDir)
        .filter(f => f.endsWith('.e2e.test.ts'))
        .sort();
}

function fail(message) {
    console.error(`check-e2e-suite-registration: ${message}`);
    process.exit(1);
}

const { staticSuites, hasDynamic } = readManifest();
const suiteFiles = listSuiteFiles();
const staticSet = new Set(staticSuites.map(s => s.replace(/^\.\//, '')));
const providerSuites = new Set(PROVIDERS.map(p => `e2e/suites/${p}.e2e.test.ts`));

// 1. Every static manifest line must reference an existing file.
for (const entry of staticSuites) {
    const rel = entry.replace(/^\.\//, '');
    if (!existsSync(join(root, rel))) {
        fail(`manifest "${entry}" does not match any existing file under the repo root.`);
    }
}

// 2. A ${provider} line must expand to all three provider contract suites.
if (!hasDynamic) {
    fail('manifest is missing a ${provider} line — the provider-specific suites (github/gitlab/gitea) would not run.');
}

// 3. Every suite file on disk must be registered.
const unregistered = [];
for (const file of suiteFiles) {
    const rel = `e2e/suites/${file}`;
    if (providerSuites.has(rel)) {
        if (!hasDynamic) unregistered.push(`${rel} (needs a \${provider} manifest line)`);
        continue;
    }
    if (!staticSet.has(rel)) {
        unregistered.push(`${rel} (add it to scripts/e2e-suites.txt)`);
    }
}

if (unregistered.length > 0) {
    fail(
        `unregistered suite file(s):\n  ${unregistered.join('\n  ')}\n` +
        `Every e2e/suites/*.e2e.test.ts must be listed in scripts/e2e-suites.txt ` +
        `(provider-specific suites via the \${provider} line) or CI will not run them.`,
    );
}

console.log(`check-e2e-suite-registration: OK — ${suiteFiles.length} suite file(s), ${staticSuites.length} static + ${hasDynamic ? '1 dynamic' : '0 dynamic'} manifest line(s).`);