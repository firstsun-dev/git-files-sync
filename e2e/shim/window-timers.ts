/**
 * Production services are written for Obsidian's Electron renderer, where
 * `window` is always a real global (e.g. GitHubService's stale-head retry
 * backoff uses `window.setTimeout`). The E2E harness runs them under
 * `environment: 'node'` (see vitest.e2e.config.ts) for a real `fetch`, which
 * has no `window` at all — discovered when a live-sandbox stale-head retry
 * (e2e/suites/github.e2e.test.ts) threw `ReferenceError: window is not
 * defined`. This is the one non-Gitea-specific shared-harness gap needed to
 * run production code as-is: a minimal `window` alias to the timer globals
 * Node already provides, not a behavioral mock.
 */
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}
