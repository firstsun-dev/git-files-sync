import { execFileSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 30_000;

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
        const command = `git ${args.join(' ')}`;
        try {
            return execFileSync('git', ['-C', this.repoDir, ...args], {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: GIT_TIMEOUT_MS,
                killSignal: 'SIGTERM',
            });
        } catch (error) {
            const stderr = error && typeof error === 'object' && 'stderr' in error
                ? String(error.stderr).trim()
                : '';
            const message = stderr || String(error);
            throw new Error(`${command} timed out after ${GIT_TIMEOUT_MS}ms: ${message}`);
        }
    }

    private fetch(ref: string): void {
        this.git(['fetch', 'origin', ref]);
    }

    /**
     * Captures one consistent remote branch state. All reads made through the
     * returned snapshot use the fetched `origin/<ref>` without another network
     * round trip.
     */
    async snapshot(ref: string): Promise<GitSnapshot> {
        this.fetch(ref);
        return new GitSnapshot(this.git.bind(this), `origin/${ref}`);
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

/** A fetch-once view of one remote branch tip. */
export class GitSnapshot {
    constructor(
        private readonly git: (args: string[]) => string,
        private readonly ref: string,
    ) {}

    getFile(path: string): { content: string; sha: string } | null {
        try {
            const sha = this.git(['rev-parse', `${this.ref}:${path}`]).trim();
            const content = this.git(['show', `${this.ref}:${path}`]);
            return { content, sha };
        } catch {
            return null;
        }
    }

    fileMissing(path: string): boolean {
        return this.getFile(path) === null;
    }

    listFiles(): string[] {
        return this.git(['ls-tree', '-r', '--name-only', this.ref])
            .split('\n')
            .filter(Boolean);
    }

    listCommitShas(perPage = 30): string[] {
        return this.git(['log', '--format=%H', '-n', String(perPage), this.ref])
            .split('\n')
            .filter(Boolean);
    }

    /** Git tree mode at path (e.g. "120000" for a symlink). */
    getBlobMode(path: string): string | null {
        const line = this.git(['ls-tree', this.ref, '--', path]).trim();
        if (!line) return null;
        return line.split(/\s+/)[0] ?? null;
    }

    /** Last commit sha that touched path -- GitLab's optimistic-locking "revision". */
    getRevision(path: string): string | null {
        const sha = this.git(['log', '-1', '--format=%H', this.ref, '--', path]).trim();
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
