import { describe, it, expect, beforeAll } from 'vitest';
import { GitVerifier } from '../support/git-verifier';
import { giteaContext } from '../config/env';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';

// Real GiteaService against a real, freshly-provisioned Gitea instance (the
// container itself was already brought up by `scripts/e2e-harness.sh
// provision`, since Gitea's whole disposable environment is the isolation
// boundary — unlike GitHub/GitLab's run-specific branch on a stable sandbox
// repo). Every remote assertion below goes through `verifier` (plain git
// CLI) rather than asking `service` to read back its own writes.
describe('GiteaService E2E', () => {
    let service: GitServiceInterface;
    let branch: string;
    let verifier: GitVerifier;
    const runId = Math.random().toString(36).slice(2, 10);
    const path = (name: string) => `e2e-${runId}/${name}`;

    beforeAll(async () => {
        const ctx = giteaContext();
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

        expect(result.sha).toBeTruthy();
        const remote = await verifier.getFile(filePath, branch);
        expect(remote?.content).toBe('# hello e2e');
        expect(remote?.sha).toBe(result.sha);
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
        expect(beforeUpdate).not.toBeNull();

        const result = await service.pushFile(filePath, 'v2', branch, 'e2e: update file', beforeUpdate?.sha);

        const afterUpdate = await verifier.getFile(filePath, branch);
        expect(afterUpdate?.content).toBe('v2');
        expect(afterUpdate?.sha).toBe(result.sha);
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
});
