/**
 * Type-only contract for the git-CLI-backed verifier `scripts/e2e-harness.sh
 * provision` generates at `${E2E_RUNTIME_DIR}/verifier/git-verifier.ts`
 * (never committed — see docs/testing/real-provider-e2e.md). Suites import
 * the concrete implementation statically from `@e2e-runtime/git-verifier`
 * (see `e2e/runtime-modules.d.ts`), which only resolves at E2E runtime via
 * the `vitest.e2e.config.ts` alias — `npm run build`'s typecheck never needs
 * the generated file to exist on disk.
 *
 * A suite must never call `service.getFile()` to confirm `service.pushFile()`
 * worked — that only proves the service agrees with itself, not that the
 * remote actually changed. Every remote assertion in an E2E suite goes
 * through one of these methods instead.
 */
export interface GitVerifier {
    /** Fetches raw file content + blob sha directly via `git show`/`git rev-parse`. */
    getFile(path: string, ref: string): Promise<{ content: string; sha: string } | null>;

    /** Lists all file paths present at `ref`, for verifying batch pushes/renames. */
    listFiles(ref: string): Promise<string[]>;

    /** True if `path` does not exist at `ref` (used to verify deletes/renames-away). */
    fileMissing(path: string, ref: string): Promise<boolean>;

    /** Commit shas on `ref`, newest first. */
    listCommitShas(ref: string, perPage?: number): Promise<string[]>;

    /** Git tree entry mode at `path` (e.g. "120000" for a symlink). */
    getBlobMode(path: string, ref: string): Promise<string | null>;

    /** Commit message at a given sha. */
    getCommitMessage(sha: string): Promise<string>;

    /** Last commit sha that touched `path` on `ref` — GitLab's optimistic-locking "revision". */
    getRevision(path: string, ref: string): Promise<string | null>;
}
