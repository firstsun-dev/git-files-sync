import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { GiteaE2EAdapter, type GiteaProvisionedProvider } from '../providers/gitea-adapter';
import { timeouts } from '../config/env';

// Real Gitea service against a real, freshly-provisioned Gitea instance (see
// e2e/provision/gitea-provision.ts). Every remote assertion below goes
// through `verifier` (raw Gitea API, e2e/verifier/gitea-verifier.ts) rather
// than asking `service` to read back its own writes.
describe('GiteaService E2E', () => {
    let ctx: GiteaProvisionedProvider;
    const adapter = new GiteaE2EAdapter();
    const runId = randomBytes(4).toString('hex');
    const path = (name: string) => `e2e-${runId}/${name}`;

    beforeAll(async () => {
        ctx = await adapter.provision();
    }, timeouts.containerReadyMs + 30_000);

    afterAll(async () => {
        // Guard against beforeAll failing before ctx is assigned (e.g. Docker/
        // container-readiness failure) — teardown must not throw in that case either.
        if (ctx) await adapter.teardown(ctx);
    });

    it('testConnection reports the repo and branch as reachable', async () => {
        const result = await ctx.service.testConnection(ctx.branch);
        expect(result).toEqual({ repoOk: true, branchOk: true });
    });

    it('creates a file, verified independently of the service', async () => {
        const filePath = path('created.md');
        const result = await ctx.service.pushFile(filePath, '# hello e2e', ctx.branch, 'e2e: create file');

        expect(result.sha).toBeTruthy();
        const remote = await ctx.verifier.getFile(filePath, ctx.branch);
        expect(remote?.content).toBe('# hello e2e');
        expect(remote?.sha).toBe(result.sha);
    });

    it('reads a file whose content was independently established', async () => {
        const filePath = path('to-read.md');
        await ctx.service.pushFile(filePath, 'known content', ctx.branch, 'e2e: create file for read test');
        // Ground truth comes from the verifier, not from calling getFile again.
        const groundTruth = await ctx.verifier.getFile(filePath, ctx.branch);
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

        const result = await ctx.service.pushFile(filePath, 'v2', ctx.branch, 'e2e: update file', beforeUpdate?.sha);

        const afterUpdate = await ctx.verifier.getFile(filePath, ctx.branch);
        expect(afterUpdate?.content).toBe('v2');
        expect(afterUpdate?.sha).toBe(result.sha);
        expect(afterUpdate?.sha).not.toBe(beforeUpdate?.sha);
    });

    it('deletes a file, verified independently of the service', async () => {
        const filePath = path('to-delete.md');
        await ctx.service.pushFile(filePath, 'delete me', ctx.branch, 'e2e: create file for delete test');
        expect(await ctx.verifier.fileMissing(filePath, ctx.branch)).toBe(false);

        await ctx.service.deleteFile(filePath, ctx.branch, 'e2e: delete file');

        expect(await ctx.verifier.fileMissing(filePath, ctx.branch)).toBe(true);
    });

    it('pushes a batch of files in one commit, verified independently of the service', async () => {
        const items = [
            { path: path('batch/a.md'), content: 'batch a' },
            { path: path('batch/b.md'), content: 'batch b' },
            { path: path('batch/c.md'), content: 'batch c' },
        ];

        const results = await ctx.service.pushBatch!(items, ctx.branch, 'e2e: batch push');
        expect(results).toHaveLength(3);

        for (const item of items) {
            const remote = await ctx.verifier.getFile(item.path, ctx.branch);
            expect(remote?.content).toBe(item.content);
        }
    });

    it('renames/moves a file in one commit, verified independently of the service', async () => {
        const oldPath = path('rename/old-name.md');
        const newPath = path('rename/new-name.md');
        await ctx.service.pushFile(oldPath, 'rename me', ctx.branch, 'e2e: create file for rename test');
        expect(await ctx.verifier.fileMissing(oldPath, ctx.branch)).toBe(false);

        await ctx.service.commitBatch!([], [{ oldPath, newPath, content: 'rename me' }], ctx.branch, 'e2e: rename file');

        expect(await ctx.verifier.fileMissing(oldPath, ctx.branch)).toBe(true);
        const remote = await ctx.verifier.getFile(newPath, ctx.branch);
        expect(remote?.content).toBe('rename me');
    });
});
