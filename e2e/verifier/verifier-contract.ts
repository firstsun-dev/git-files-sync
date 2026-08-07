/**
 * Contract for a provider's independent verifier: raw API calls made
 * without going through the production GitServiceInterface implementation
 * under test. A suite must never call `service.getFile()` to confirm
 * `service.pushFile()` worked — that only proves the service agrees with
 * itself, not that the remote actually changed. Every remote assertion in
 * an E2E suite goes through one of these methods instead.
 */
export interface RemoteVerifier {
    /** Fetches raw file content + blob sha directly from the provider's API. */
    getFile(path: string, ref: string): Promise<{ content: string; sha: string } | null>;

    /** Lists all file paths present at `ref`, for verifying batch pushes/renames. */
    listFiles(ref: string): Promise<string[]>;

    /** True if `path` does not exist at `ref` (used to verify deletes/renames-away). */
    fileMissing(path: string, ref: string): Promise<boolean>;

    /** Commit shas on `ref`, newest first — used to assert a batch/rename/push landed as exactly N new commits, without trusting the service under test's own commit count. */
    listCommitShas(ref: string, perPage?: number): Promise<string[]>;
}
