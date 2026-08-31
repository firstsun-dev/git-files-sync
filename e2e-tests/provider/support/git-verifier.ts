import { execFileSync } from 'node:child_process';

/**
 * Independent verifier backed by plain git CLI against the isolated clone
 * `scripts/e2e-harness.sh` already checked out at `$E2E_WORKDIR/repo` --
 * never the service under test reading back its own writes.
 *
 * A suite must never call `service.getFile()` to confirm `service.pushFile()`
 * worked — that only proves the service agrees with itself, not that the
 * remote actually changed. Every remote assertion in an E2E suite goes
 * through one of these methods instead.
 */
export class GitVerifier {
    constructor(private readonly repoDir: string = defaultRepoDir()) {}

    private git(args: string[]): string {
        try {
            return execFileSync('git', ['-C', this.repoDir, ...args], {
                encoding: 'utf-8',
                // Pipe stderr so an *expected* missing path (getFile's
                // try/catch -> null) stays silent instead of spamming the log
                // with "fatal: path does not exist". A genuine, unexpected git
                // failure still surfaces: callers without their own try/catch
                // re-throw below with the captured stderr attached.
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (error) {
            const stderr = error && typeof error === 'object' && 'stderr' in error
                ? String(error.stderr).trim()
                : '';
            throw new Error(
                `git ${args.join(' ')} failed` + (stderr ? `:\n${stderr}` : ''),
            );
        }
    }

    private fetch(ref: string): void {
        this.git(['fetch', 'origin', ref]);
    }

    async getFile(path: string, ref: string): Promise<{ content: string; sha: string } | null> {
        this.fetch(ref);
        try {
            const sha = this.git(['rev-parse', `origin/${ref}:${path}`]).trim();
            const content = this.git(['show', `origin/${ref}:${path}`]);
            return { content, sha };
        } catch {
            return null;
        }
    }

    async listFiles(ref: string): Promise<string[]> {
        this.fetch(ref);
        return this.git(['ls-tree', '-r', '--name-only', `origin/${ref}`])
            .split('\n')
            .filter(Boolean);
    }

    async fileMissing(path: string, ref: string): Promise<boolean> {
        return (await this.getFile(path, ref)) === null;
    }

    async listCommitShas(ref: string, perPage = 30): Promise<string[]> {
        this.fetch(ref);
        return this.git(['log', '--format=%H', '-n', String(perPage), `origin/${ref}`])
            .split('\n')
            .filter(Boolean);
    }

    /** Git tree mode at path (e.g. "120000" for a symlink). */
    async getBlobMode(path: string, ref: string): Promise<string | null> {
        this.fetch(ref);
        const line = this.git(['ls-tree', `origin/${ref}`, '--', path]).trim();
        if (!line) return null;
        return line.split(/\s+/)[0] ?? null;
    }

    async getCommitMessage(sha: string): Promise<string> {
        return this.git(['log', '-1', '--format=%B', sha]).trim();
    }

    /** Last commit sha that touched path -- GitLab's optimistic-locking "revision". */
    async getRevision(path: string, ref: string): Promise<string | null> {
        this.fetch(ref);
        const sha = this.git(['log', '-1', '--format=%H', `origin/${ref}`, '--', path]).trim();
        return sha || null;
    }
}

// `scripts/run-e2e.sh` always exports E2E_WORKDIR (from provision's
// e2e.env) into the vitest process before suites run; the clone this
// verifier reads lives at `$E2E_WORKDIR/repo` (see e2e-harness.sh's
// clone_dir()).
function defaultRepoDir(): string {
    const workdir = process.env.E2E_WORKDIR;
    if (!workdir) {
        throw new Error(
            'E2E_WORKDIR is not set -- GitVerifier must run via scripts/run-e2e.sh (or the CI steps), not npx vitest directly.',
        );
    }
    return `${workdir}/repo`;
}
