import { describe, it, expect, beforeAll } from 'vitest';
import { GitVerifier } from '../support/git-verifier';
import { gitlabContext } from '../config/env';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';

// Real GitLabService against a dedicated real GitLab sandbox project, on the
// isolated branch `scripts/e2e-harness.sh provision` already created. Every
// remote assertion below goes through `verifier` (plain git CLI) rather than
// asking `service` to read back its own writes.
describe('GitLabService E2E', () => {
    let service: GitServiceInterface;
    let branch: string;
    let verifier: GitVerifier;
    const runId = Math.random().toString(36).slice(2, 10);
    const path = (name: string) => `e2e-${runId}/${name}`;

    beforeAll(async () => {
        const ctx = gitlabContext();
        service = ctx.service;
        branch = ctx.branch;
        verifier = new GitVerifier();
    });

    it('testConnection reports the repo and branch as reachable', async () => {
        const result = await service.testConnection(branch);
        expect(result).toEqual({ repoOk: true, branchOk: true });
    });

    it('creates a file, verified independently of the service', async () => {
        const filePath = path('created.md');
        const result = await service.pushFile(filePath, '# hello e2e', branch, 'e2e: create file');
        expect(result.path).toBe(filePath);

        const remote = await verifier.getFile(filePath, branch);
        expect(remote?.content).toBe('# hello e2e');
    });

    it('reads a file whose content was independently established', async () => {
        const filePath = path('to-read.md');
        await service.pushFile(filePath, 'known content', branch, 'e2e: create file for read test');
        const groundTruth = await verifier.getFile(filePath, branch);
        expect(groundTruth?.content).toBe('known content');

        const read = await service.getFile(filePath, branch);
        expect(read.content).toBe('known content');
        expect(read.sha).toBe(groundTruth?.sha);
    });

    it('updates a file, verified independently of the service', async () => {
        const filePath = path('to-update.md');
        await service.pushFile(filePath, 'v1', branch, 'e2e: create file for update test');
        const beforeUpdate = await verifier.getFile(filePath, branch);
        expect(beforeUpdate?.sha).toBeTruthy();

        const pulled = await service.getFile(filePath, branch);
        await service.pushFile(filePath, 'v2', branch, 'e2e: update file', pulled.sha, pulled.revision);

        const afterUpdate = await verifier.getFile(filePath, branch);
        expect(afterUpdate?.content).toBe('v2');
        expect(afterUpdate?.sha).not.toBe(beforeUpdate?.sha);
    });

    it('deletes a file, verified independently of the service', async () => {
        const filePath = path('to-delete.md');
        await service.pushFile(filePath, 'delete me', branch, 'e2e: create file for delete test');
        expect(await verifier.fileMissing(filePath, branch)).toBe(false);

        await service.deleteFile(filePath, branch, 'e2e: delete file');

        expect(await verifier.fileMissing(filePath, branch)).toBe(true);
    });

    it('pushes a batch of files in one commit, verified independently of the service', async () => {
        const items = [
            { path: path('batch/a.md'), content: 'batch a' },
            { path: path('batch/b.md'), content: 'batch b' },
            { path: path('batch/c.md'), content: 'batch c' },
        ];

        const results = await service.pushBatch!(items, branch, 'e2e: batch push');
        expect(results).toHaveLength(3);

        for (const item of items) {
            const remote = await verifier.getFile(item.path, branch);
            expect(remote?.content).toBe(item.content);
        }
    });

    it('renames/moves a file in one commit, verified independently of the service', async () => {
        const oldPath = path('rename/old-name.md');
        const newPath = path('rename/new-name.md');
        await service.pushFile(oldPath, 'rename me', branch, 'e2e: create file for rename test');
        expect(await verifier.fileMissing(oldPath, branch)).toBe(false);

        await service.commitBatch!({ writes: [], moves: [{ oldPath, newPath, content: 'rename me' }], deletions: [] }, branch, 'e2e: rename file');

        expect(await verifier.fileMissing(oldPath, branch)).toBe(true);
        const remote = await verifier.getFile(newPath, branch);
        expect(remote?.content).toBe('rename me');
    });

    // P0 regression coverage for issue #101 (fixed in PR #113, commit
    // ad15238). GitLab exposes two distinct identities for a file: blob_id
    // (GitFile.sha, content identity) vs last_commit_id (GitFile.revision,
    // the write API's optimistic-locking token) — conflating them silently
    // disabled conflict detection rather than causing false conflicts. See
    // the original suite's history for the full incident writeup.
    describe('P0 regression (#101): blob sha vs revision separation', () => {
        it('single pull -> obtain sha + revision -> edit -> push succeeds without a false conflict', async () => {
            const filePath = path('regression-101.md');
            await service.pushFile(filePath, 'v1', branch, 'e2e: create for #101 regression');

            const pulled = await service.getFile(filePath, branch);
            expect(pulled.sha).toBeTruthy();
            expect(pulled.revision).toBeTruthy();
            expect(pulled.sha).not.toBe(pulled.revision);

            await service.pushFile(filePath, 'v2 edited locally', branch, 'e2e: edit for #101 regression', pulled.sha, pulled.revision);

            const remote = await verifier.getFile(filePath, branch);
            expect(remote?.content).toBe('v2 edited locally');

            const remoteRevisionAfter = await verifier.getRevision(filePath, branch);
            expect(remoteRevisionAfter).not.toBe(pulled.revision);
        });

        it('the fix works: a genuinely stale revision (real concurrent edit) is correctly rejected', async () => {
            const filePath = path('regression-101-real-conflict.md');
            await service.pushFile(filePath, 'v1', branch, 'e2e: create for #101 real-conflict test');
            const pulled = await service.getFile(filePath, branch);

            await service.pushFile(filePath, 'concurrent edit by someone else', branch, 'e2e: concurrent edit', pulled.sha, pulled.revision);

            await expect(
                service.pushFile(filePath, 'stale local edit', branch, 'e2e: stale push should conflict', pulled.sha, pulled.revision)
            ).rejects.toThrow();

            const remote = await verifier.getFile(filePath, branch);
            expect(remote?.content).toBe('concurrent edit by someone else');
        });

        it('reproduces the original #101 bug: blob sha as the lock token silently bypasses conflict detection', async () => {
            const filePath = path('regression-101-bug-repro.md');
            await service.pushFile(filePath, 'v1', branch, 'e2e: create for #101 bug repro');
            const pulled = await service.getFile(filePath, branch);

            await service.pushFile(filePath, 'concurrent edit by someone else', branch, 'e2e: concurrent edit', pulled.sha, pulled.revision);

            await expect(
                service.pushFile(filePath, 'stale local edit using sha as lock token', branch, 'e2e: regression bug reproduction', pulled.sha, pulled.sha)
            ).resolves.not.toThrow();

            const remote = await verifier.getFile(filePath, branch);
            expect(remote?.content).toBe('stale local edit using sha as lock token');
        });

        it('batch push after a pull + local edit does not falsely conflict', async () => {
            const filePath = path('regression-101-batch.md');
            await service.pushFile(filePath, 'batch v1', branch, 'e2e: create for #101 batch regression');
            const pulled = await service.getFile(filePath, branch);
            expect(pulled.sha).toBeTruthy();

            const results = await service.pushBatch!(
                [{ path: filePath, content: 'batch v2 edited', existedRemotely: true }],
                branch,
                'e2e: batch push after pull for #101 regression'
            );
            expect(results).toHaveLength(1);

            const remote = await verifier.getFile(filePath, branch);
            expect(remote?.content).toBe('batch v2 edited');
            expect(results[0]?.sha).not.toBe(pulled.revision);
        });
    });
});
