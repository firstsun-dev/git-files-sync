import { describe, it, expect, beforeAll } from 'vitest';
import { githubContext, runtimeDir } from '../config/env';
import type { GitServiceInterface } from '../../src/services/git-service-interface';
import type { GitVerifier as GitVerifierType } from '../verifier-runtime-types';

// Real GitHubService against a real GitHub sandbox repository, on the
// isolated branch `scripts/e2e-harness.sh provision` already created (see
// docs/testing/real-provider-e2e.md). Every remote assertion below goes
// through `verifier` (plain git CLI against an independent clone, generated
// by the harness) rather than asking `service` to read back its own writes.
describe('GitHubService E2E', () => {
    let service: GitServiceInterface;
    let branch: string;
    let verifier: GitVerifierType;
    const runId = Math.random().toString(36).slice(2, 10);
    const path = (name: string) => `e2e-${runId}/${name}`;

    /**
     * GitHub's Contents API can briefly lag a just-completed write or delete;
     * poll instead of asserting on a single read.
     */
    async function waitFor<T>(getter: () => Promise<T>, satisfied: (value: T) => boolean, attempts = 6, delayMs = 500): Promise<T> {
        let last: T;
        for (let i = 0; i < attempts; i++) {
            last = await getter();
            if (satisfied(last)) return last;
            if (i < attempts - 1) await new Promise(resolve => window.setTimeout(resolve, delayMs));
        }
        return last!;
    }

    const waitForContent = (getter: () => Promise<{ content: string; sha: string } | null>, expectedContent: string) =>
        waitFor(getter, value => value?.content === expectedContent);

    const waitForMissing = (path_: string, branch_: string) =>
        waitFor(() => verifier.fileMissing(path_, branch_), missing => missing === true);

    beforeAll(async () => {
        const ctx = githubContext();
        service = ctx.service;
        branch = ctx.branch;
        const { GitVerifier } = await import(/* @vite-ignore */ `${runtimeDir()}/verifier/git-verifier.ts`) as { GitVerifier: new () => GitVerifierType };
        verifier = new GitVerifier();
    });

    it('testConnection reports the repo and branch as reachable', async () => {
        const result = await service.testConnection(branch);
        expect(result).toEqual({ repoOk: true, branchOk: true });
    });

    it('creates a file via createCommitOnBranch, verified independently of the service', async () => {
        const filePath = path('created.md');
        const commitsBeforePush = await verifier.listCommitShas(branch, 1);

        const result = await service.pushFile(filePath, '# hello e2e', branch, 'e2e: create file');

        expect(result.sha).toBeUndefined(); // GitHubService's GraphQL path doesn't report a blob sha
        const remote = await waitForContent(() => verifier.getFile(filePath, branch), '# hello e2e');
        expect(remote?.content).toBe('# hello e2e');

        const newTip = await waitFor(
            () => verifier.listCommitShas(branch, 1),
            shas => shas[0] !== commitsBeforePush[0]
        );
        expect(await verifier.getCommitMessage(newTip[0]!)).toContain('e2e: create file');
    });

    it('reads a file whose content was independently established', async () => {
        const filePath = path('to-read.md');
        await service.pushFile(filePath, 'known content', branch, 'e2e: create file for read test');
        const groundTruth = await waitForContent(() => verifier.getFile(filePath, branch), 'known content');
        expect(groundTruth?.content).toBe('known content');

        const read = await service.getFile(filePath, branch);
        expect(read.content).toBe('known content');
        expect(read.sha).toBe(groundTruth?.sha);
    });

    it('updates a file, verified independently of the service', async () => {
        const filePath = path('to-update.md');
        await service.pushFile(filePath, 'v1', branch, 'e2e: create file for update test');
        const beforeUpdate = await verifier.getFile(filePath, branch);
        expect(beforeUpdate).not.toBeNull();

        await service.pushFile(filePath, 'v2', branch, 'e2e: update file', beforeUpdate?.sha);

        const afterUpdate = await waitForContent(() => verifier.getFile(filePath, branch), 'v2');
        expect(afterUpdate?.content).toBe('v2');
        expect(afterUpdate?.sha).not.toBe(beforeUpdate?.sha);
    });

    it('deletes a file, verified independently of the service', async () => {
        const filePath = path('to-delete.md');
        await service.pushFile(filePath, 'delete me', branch, 'e2e: create file for delete test');
        expect(await waitFor(() => verifier.fileMissing(filePath, branch), missing => missing === false)).toBe(false);

        await service.deleteFile(filePath, branch, 'e2e: delete file');

        expect(await waitForMissing(filePath, branch)).toBe(true);
    });

    it('pushes a batch of files as exactly one commit, verified independently of the service', async () => {
        const items = [
            { path: path('batch/a.md'), content: 'batch a' },
            { path: path('batch/b.md'), content: 'batch b' },
            { path: path('batch/c.md'), content: 'batch c' },
        ];

        const commitsBefore = await verifier.listCommitShas(branch, 1);
        const results = await service.pushBatch!(items, branch, 'e2e: batch push');
        expect(results).toHaveLength(3);

        for (const item of items) {
            const remote = await waitForContent(() => verifier.getFile(item.path, branch), item.content);
            expect(remote?.content).toBe(item.content);
        }

        const commitsAfter = await verifier.listCommitShas(branch, 2);
        expect(commitsAfter[1]).toBe(commitsBefore[0]);
        expect(await verifier.getCommitMessage(commitsAfter[0]!)).toContain('e2e: batch push');
    });

    it('renames/moves a file in one commit, verified independently of the service', async () => {
        const oldPath = path('rename/old-name.md');
        const newPath = path('rename/new-name.md');
        await service.pushFile(oldPath, 'rename me', branch, 'e2e: create file for rename test');
        expect(await waitFor(() => verifier.fileMissing(oldPath, branch), missing => missing === false)).toBe(false);

        await service.commitBatch!({ writes: [], moves: [{ oldPath, newPath, content: 'rename me' }], deletions: [] }, branch, 'e2e: rename file');

        expect(await waitForMissing(oldPath, branch)).toBe(true);
        const remote = await waitForContent(() => verifier.getFile(newPath, branch), 'rename me');
        expect(remote?.content).toBe('rename me');
    });

    // GitHub-specific regression/behavior coverage, beyond the common provider
    // contract above.
    describe('GitHub-specific behavior', () => {
        it('pushes a symlink via the Git Data API (mode 120000), verified independently of the service', async () => {
            const filePath = path('symlink/link.md');
            const target = '../shared/note.md';

            const result = await service.pushSymlink!(filePath, target, branch, 'e2e: create symlink');
            expect(result.sha).toBeTruthy();

            const mode = await waitFor(() => verifier.getBlobMode(filePath, branch), value => value !== null);
            expect(mode).toBe('120000');
            // A git symlink blob's content *is* the link target.
            const entry = await waitFor(() => verifier.getFile(filePath, branch), value => value !== null);
            expect(entry?.content).toBe(target);
        });

        it('surfaces a real GraphQL HTTP-200-with-errors[] response as a rejection, without writing anything', async () => {
            const dirPath = path('collide');
            const commitsBeforeSetup = await verifier.listCommitShas(branch, 1);
            await service.pushFile(`${dirPath}/existing.md`, 'inside the directory', branch, 'e2e: create colliding directory');
            const commitsBeforeAttempt = await waitFor(
                () => verifier.listCommitShas(branch, 1),
                shas => shas[0] !== commitsBeforeSetup[0]
            );

            await expect(
                service.pushFile(dirPath, 'this path collides with a directory', branch, 'e2e: attempt collision')
            ).rejects.toThrow();

            const commitsAfterAttempt = await verifier.listCommitShas(branch, 1);
            expect(commitsAfterAttempt).toEqual(commitsBeforeAttempt);
            const untouched = await verifier.getFile(`${dirPath}/existing.md`, branch);
            expect(untouched?.content).toBe('inside the directory');
        });

        it('self-heals a stale expectedHeadOid under real concurrent writes to the same branch', async () => {
            const items = Array.from({ length: 2 }, (_, i) => ({
                filePath: path(`concurrent/file-${i}.md`),
                content: `concurrent content ${i}`,
            }));

            await Promise.all(
                items.map(item => service.pushFile(item.filePath, item.content, branch, `e2e: concurrent push ${item.filePath}`))
            );

            for (const item of items) {
                const remote = await waitForContent(() => verifier.getFile(item.filePath, branch), item.content);
                expect(remote?.content).toBe(item.content);
            }
        });
    });
});
