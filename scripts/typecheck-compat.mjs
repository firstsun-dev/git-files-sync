#!/usr/bin/env node
/*
 * Type-checks src/ against the exact Obsidian API version this release targets.
 * Any use of an API newer than our declared minAppVersion that is NOT
 * runtime-guarded becomes a compile error here.
 *
 * The target version is derived dynamically — never hardcoded. versions.json
 * maps each plugin version to its minAppVersion; we use the entry for the
 * current manifest version, falling back to manifest.minAppVersion (which is the
 * canonical floor, and the reliable source when version-bump.mjs omits a
 * versions.json entry because the minAppVersion was unchanged).
 *
 * The matching Obsidian typings are installed on demand into node_modules/.cache
 * (git-ignored) and reused across runs, so bumping minAppVersion automatically
 * re-points this check with no code changes.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const manifest = readJson('manifest.json');
const versions = readJson('versions.json');
const target = versions[manifest.version] ?? manifest.minAppVersion;

if (!target) {
	console.error('compat: could not resolve target Obsidian version from versions.json / manifest.json');
	process.exit(1);
}

// Install the target typings into a per-version cache (reused on later runs).
const cacheDir = join(root, 'node_modules', '.cache', 'obsidian-compat', target);
const dtsBase = join(cacheDir, 'node_modules', 'obsidian', 'obsidian'); // no extension
if (!existsSync(`${dtsBase}.d.ts`)) {
	mkdirSync(cacheDir, { recursive: true });
	console.log(`compat: installing obsidian@${target} typings...`);
	execSync(
		`npm install --prefix "${cacheDir}" --no-save --no-audit --no-fund --loglevel=error obsidian@${target}`,
		{ stdio: 'inherit' },
	);
}

// Generate a tsconfig that points the "obsidian" import at the target typings.
const generated = join(root, 'tsconfig.compat.generated.json');
writeFileSync(generated, `${JSON.stringify({
	extends: './tsconfig.json',
	compilerOptions: {
		noEmit: true,
		skipLibCheck: true,
		baseUrl: '.',
		paths: { obsidian: [relative(root, dtsBase).split('\\').join('/')] },
	},
	include: ['src/**/*.ts'],
}, null, '\t')}\n`);

console.log(`compat: type-checking src against Obsidian ${target} API...`);
execSync(`node "${join(root, 'node_modules', 'typescript', 'bin', 'tsc')}" -p "${generated}"`, { stdio: 'inherit' });
console.log(`compat: ✓ src is compatible with Obsidian ${target}`);
