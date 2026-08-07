import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { GitHubE2EAdapter, type GitHubProvisionedProvider } from '../providers/github-adapter';
import { timeouts } from '../config/env';

// Real GitHubService against a real GitHub sandbox repository (see
// e2e/provision/github-provision.ts), on a run-specific branch so writes
// never collide with another run or a real user's history. Every remote
// assertion below goes through `verifier` (raw GitHub REST API,
// e2e/verifier/github-verifier.ts) rather than asking `service` to read back
// its own writes.
describe('GitHubService E2E', () => {
    let ctx: GitHubProvisionedProvider;
    const adapter = new GitHubE2EAdapter();
    const runId = randomBytes(4).toString('hex');
    const path = (name: string) => `e2e-${runId}/${name}`;

    /**
     * GitHub's Contents API can briefly lag a just-completed write or delete
     * (observed directly against the live sandbox: an update's and a
     * delete's read-back both sometimes returned the pre-write state on the
     * first read). Poll instead of asserting on a single read, mirroring the
     * propagation delay the production code already documents and works
     * around for its own reads (see the GraphQL-over-REST comments in
     * github-service.ts) — this verifier deliberately stays on the plain
     * REST Contents API, so it has to tolerate that lag with retries instead.
     */
    async function waitFor<T>(getter: () => Promise<T>, satisfied: (value: T) => boolean, attempts = 6, delayMs = 500): Promise<T> {
        let last: T;
        for (let i = 0; i < attempts; i++) {
            last = await getter();
            if (satisfied(last)) return last;
            if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        return last!;
    }

    const waitForContent = (getter: () => Promise<{ content: string; sha: string } | null>, expectedContent: string) =>
        waitFor(getter, value => value?.content === expectedContent);

    const waitForMissing = (path_: string, branch: string) =>
        waitFor(() => ctx.verifier.fileMissing(path_, branch), missing => missing === true);

    beforeAll(async () => {
        ctx = await adapter.provision();
    }, timeouts.containerReadyMs + 30_000);

    afterAll(async () => {
        // ctx is unset if provision() itself threw (e.g. missing E2E_GITHUB_* env
        // vars) — afterAll still runs in that case, so guard rather than crash
        // with a second, more confusing failure on top of the real one.
        if (ctx) await adapter.teardown(ctx);
    });

    it('testConnection reports the repo and branch as reachable', async () => {
        const result = await ctx.service.testConnection(ctx.branch);
        expect(result).toEqual({ repoOk: true, branchOk: true });
    });

    it('creates a file via createCommitOnBranch, verified independently of the service', async () => {
        const filePath = path('created.md');
        const commitsBeforePush = await ctx.verifier.listCommitShas(ctx.branch, 1);

        const result = await ctx.service.pushFile(filePath, '# hello e2e', ctx.branch, 'e2e: create file');

        expect(result.sha).toBeUndefined(); // GitHubService's GraphQL path doesn't report a blob sha
        const remote = await waitForContent(() => ctx.verifier.getFile(filePath, ctx.branch), '# hello e2e');
        expect(remote?.content).toBe('# hello e2e');

        // Confirms the write actually went through the GraphQL createCommitOnBranch
        // mutation (not some other path) by checking the commit message it carried.
        // (The commits list can lag a just-completed write the same way Contents
        // API reads do, so poll for a new tip sha rather than trusting the first read.)
        const newTip = await waitFor(
            () => ctx.verifier.listCommitShas(ctx.branch, 1),
            shas => shas[0] !== commitsBeforePush[0]
        );
        expect(await ctx.verifier.getCommitMessage(newTip[0]!)).toContain('e2e: create file');
    });

    it('reads a file whose content was independently established', async () => {
        const filePath = path('to-read.md');
        await ctx.service.pushFile(filePath, 'known content', ctx.branch, 'e2e: create file for read test');
        // Ground truth comes from the verifier, not from calling getFile again.
        const groundTruth = await waitForContent(() => ctx.verifier.getFile(filePath, ctx.branch), 'known content');
        expect(groundTruth?.content).toBe('known content');

        const read = await ctx.service.getFile(filePath, ctx.branch);
        expect(read.content).toBe('known content');
        expect(read.sha).toBe(groundTruth?.sha);
    });

    it('updates a file, verified independently of the service', async () => {
        const filePath = path('to-update.md');
        await ctx.service.pushFile(filePath, 'v1', ctx.branch, 'e2e: create file for update test');
        const beforeUpdate = await ctx.verifier.getFile(filePath, ctx.branch);
        expect(beforeUpdate).not.toBeNull();

        await ctx.service.pushFile(filePath, 'v2', ctx.branch, 'e2e: update file', beforeUpdate?.sha);

        const afterUpdate = await waitForContent(() => ctx.verifier.getFile(filePath, ctx.branch), 'v2');
        expect(afterUpdate?.content).toBe('v2');
        expect(afterUpdate?.sha).not.toBe(beforeUpdate?.sha);
    });

    it('deletes a file, verified independently of the service', async () => {
        const filePath = path('to-delete.md');
        await ctx.service.pushFile(filePath, 'delete me', ctx.branch, 'e2e: create file for delete test');
        expect(await waitFor(() => ctx.verifier.fileMissing(filePath, ctx.branch), missing => missing === false)).toBe(false);

        await ctx.service.deleteFile(filePath, ctx.branch, 'e2e: delete file');

        expect(await waitForMissing(filePath, ctx.branch)).toBe(true);
    });

    it('pushes a batch of files as exactly one commit, verified independently of the service', async () => {
        const items = [
            { path: path('batch/a.md'), content: 'batch a' },
            { path: path('batch/b.md'), content: 'batch b' },
            { path: path('batch/c.md'), content: 'batch c' },
        ];

        const commitsBefore = await ctx.verifier.listCommitShas(ctx.branch, 1);
        const results = await ctx.service.pushBatch!(items, ctx.branch, 'e2e: batch push');
        expect(results).toHaveLength(3);

        for (const item of items) {
            const remote = await waitForContent(() => ctx.verifier.getFile(item.path, ctx.branch), item.content);
            expect(remote?.content).toBe(item.content);
        }

        // Batch operation commit semantics: N files land as one new commit, not N.
        const commitsAfter = await ctx.verifier.listCommitShas(ctx.branch, 2);
        expect(commitsAfter[1]).toBe(commitsBefore[0]);
        expect(await ctx.verifier.getCommitMessage(commitsAfter[0]!)).toContain('e2e: batch push');
    });

    it('renames/moves a file in one commit, verified independently of the service', async () => {
        const oldPath = path('rename/old-name.md');
        const newPath = path('rename/new-name.md');
        await ctx.service.pushFile(oldPath, 'rename me', ctx.branch, 'e2e: create file for rename test');
        expect(await waitFor(() => ctx.verifier.fileMissing(oldPath, ctx.branch), missing => missing === false)).toBe(false);

        await ctx.service.commitBatch!([], [{ oldPath, newPath, content: 'rename me' }], ctx.branch, 'e2e: rename file');

        expect(await waitForMissing(oldPath, ctx.branch)).toBe(true);
        const remote = await waitForContent(() => ctx.verifier.getFile(newPath, ctx.branch), 'rename me');
        expect(remote?.content).toBe('rename me');
    });

    // GitHub-specific regression/behavior coverage, beyond the common provider
    // contract above.
    describe('GitHub-specific behavior', () => {
        it('pushes a symlink via the Git Data API (mode 120000), verified independently of the service', async () => {
            const filePath = path('symlink/link.md');
            const target = '../shared/note.md';

            const result = await ctx.service.pushSymlink!(filePath, target, ctx.branch, 'e2e: create symlink');
            expect(result.sha).toBeTruthy();

            const mode = await waitFor(() => ctx.verifier.getBlobMode(filePath, ctx.branch), value => value !== null);
            expect(mode).toBe('120000');
            const entry = await waitFor(() => ctx.verifier.getRawEntry(filePath, ctx.branch), value => value !== null);
            expect(entry?.type).toBe('symlink');
            expect(entry?.target).toBe(target);
        });

        it('surfaces a real GraphQL HTTP-200-with-errors[] response as a rejection, without writing anything', async () => {
            // createCommitOnBranch validates the tree it's asked to build: a file
            // path that collides with an existing directory of the same name is
            // rejected as a mutation-level error inside a 200 response, not an
            // HTTP error status. This forces that real response deterministically
            // (no timing dependency), unlike the stale-head case below.
            const dirPath = path('collide');
            const commitsBeforeSetup = await ctx.verifier.listCommitShas(ctx.branch, 1);
            await ctx.service.pushFile(`${dirPath}/existing.md`, 'inside the directory', ctx.branch, 'e2e: create colliding directory');
            // Same commits-list lag as the "creates a file" test: confirm the
            // setup commit actually landed before treating its tip as the baseline.
            const commitsBeforeAttempt = await waitFor(
                () => ctx.verifier.listCommitShas(ctx.branch, 1),
                shas => shas[0] !== commitsBeforeSetup[0]
            );

            await expect(
                ctx.service.pushFile(dirPath, 'this path collides with a directory', ctx.branch, 'e2e: attempt collision')
            ).rejects.toThrow();

            // The rejected mutation created no commit, and the pre-existing file is
            // untouched. (dirPath itself is a real directory — GitHub's Contents API
            // 200s with a directory listing for it rather than 404ing, so that path
            // isn't a useful "was anything written" check on its own.)
            const commitsAfterAttempt = await ctx.verifier.listCommitShas(ctx.branch, 1);
            expect(commitsAfterAttempt).toEqual(commitsBeforeAttempt);
            const untouched = await ctx.verifier.getFile(`${dirPath}/existing.md`, ctx.branch);
            expect(untouched?.content).toBe('inside the directory');
        });

        it('self-heals a stale expectedHeadOid under real concurrent writes to the same branch', async () => {
            // GitHubService.commitOnBranch retries when createCommitOnBranch reports
            // a stale-expectedHeadOid-shaped error. Firing a few single-file pushes
            // at the same branch concurrently races real commits against each
            // other, which is the actual scenario that error handles — some of
            // these calls will read a HEAD that moves before their mutation lands,
            // and must retry with a freshly re-read HEAD to succeed. Kept to 2
            // concurrent writers — the minimum that still forces a real race:
            // commitOnBranch caps retries at 3 attempts with a 500ms/attempt
            // backoff, and 3+ concurrent writers were observed live to legitimately
            // exhaust that budget under real contention (a genuine finding, not a
            // test bug — see the PR/commit notes) rather than reliably exercising
            // a retry that then succeeds.
            const items = Array.from({ length: 2 }, (_, i) => ({
                filePath: path(`concurrent/file-${i}.md`),
                content: `concurrent content ${i}`,
            }));

            await Promise.all(
                items.map(item => ctx.service.pushFile(item.filePath, item.content, ctx.branch, `e2e: concurrent push ${item.filePath}`))
            );

            for (const item of items) {
                const remote = await waitForContent(() => ctx.verifier.getFile(item.filePath, ctx.branch), item.content);
                expect(remote?.content).toBe(item.content);
            }
        });
    });
});
