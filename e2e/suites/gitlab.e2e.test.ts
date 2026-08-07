import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { GitLabE2EAdapter, type GitLabProvisionedProvider } from '../providers/gitlab-adapter';
import { timeouts } from '../config/env';

// Real GitLabService against a dedicated real GitLab sandbox project (see
// e2e/provision/gitlab-provision.ts) on a run-specific branch. Every remote
// assertion below goes through `verifier` (raw GitLab API,
// e2e/verifier/gitlab-verifier.ts) rather than asking `service` to read back
// its own writes.
describe('GitLabService E2E', () => {
    let ctx: GitLabProvisionedProvider;
    const adapter = new GitLabE2EAdapter();
    const runId = randomBytes(4).toString('hex');
    const path = (name: string) => `e2e-${runId}/${name}`;

    beforeAll(async () => {
        ctx = await adapter.provision();
    }, timeouts.containerReadyMs + 30_000);

    afterAll(async () => {
        // Guard against beforeAll failing before ctx is assigned (e.g. missing
        // sandbox credentials) — teardown must not throw in that case either.
        if (ctx) await adapter.teardown(ctx);
    });

    it('testConnection reports the repo and branch as reachable', async () => {
        const result = await ctx.service.testConnection(ctx.branch);
        expect(result).toEqual({ repoOk: true, branchOk: true });
    });

    it('creates a file, verified independently of the service', async () => {
        const filePath = path('created.md');
        // Unlike Gitea/GitHub's contents API, GitLab's create/update file
        // endpoint response body is just `{ file_path, branch }` — no blob
        // sha (confirmed directly against a real GitLab.com project, not
        // just inferred from the type). pushFile's `sha` return is therefore
        // undefined by design for GitLab; SyncManager.performPush already
        // accounts for this with a `result.sha ?? gitBlobSha(content)`
        // fallback (src/logic/sync-manager.ts), so this is not asserted here.
        const result = await ctx.service.pushFile(filePath, '# hello e2e', ctx.branch, 'e2e: create file');
        expect(result.path).toBe(filePath);

        const remote = await ctx.verifier.getFile(filePath, ctx.branch);
        expect(remote?.content).toBe('# hello e2e');
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
        expect(beforeUpdate?.sha).toBeTruthy();

        // Matches SyncManager.performPush: existingSha decides create-vs-update
        // (PUT vs POST), existingRevision (last_commit_id) is GitLab's
        // optimistic-locking token — see the #101 regression suite below for
        // why these must never be conflated. GitLab's write response carries
        // no blob sha (see the "creates a file" test above), so the new sha
        // is read back through the independent verifier, not from the
        // pushFile return value.
        const pulled = await ctx.service.getFile(filePath, ctx.branch);
        await ctx.service.pushFile(filePath, 'v2', ctx.branch, 'e2e: update file', pulled.sha, pulled.revision);

        const afterUpdate = await ctx.verifier.getFile(filePath, ctx.branch);
        expect(afterUpdate?.content).toBe('v2');
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

    // P0 regression coverage for issue #101 (fixed in PR #113, commit
    // ad15238). GitLab exposes two distinct identities for a file:
    //   - blob_id  (GitFile.sha)      — content identity, stable across
    //                                   syncs that don't change the bytes.
    //   - last_commit_id (GitFile.revision) — the write API's optimistic
    //                                   locking token; it changes on every
    //                                   commit that touches the file, even
    //                                   an unrelated one elsewhere in the
    //                                   repo can bump it.
    //
    // Verified directly against a real GitLab.com project (outside this
    // production code, via raw curl) what actually happens when the two are
    // conflated: a genuinely stale-but-valid last_commit_id (a real, older
    // commit id) IS correctly rejected with 400 "you are attempting to
    // update a file that has changed since you started editing it" — but a
    // syntactically-valid-yet-nonexistent value, such as a blob_id, is
    // silently ACCEPTED. GitLab's optimistic-lock check appears to resolve
    // last_commit_id to an actual commit first and no-ops the check entirely
    // if that resolution fails, rather than rejecting on a literal mismatch.
    // So the pre-#101-fix bug (sending blob_id as last_commit_id) did not
    // manifest as spurious false conflicts — it silently disabled conflict
    // detection altogether, letting concurrent edits overwrite each other
    // with no warning. That is the behavior these tests protect against.
    describe('P0 regression (#101): blob sha vs revision separation', () => {
        it('single pull -> obtain sha + revision -> edit -> push succeeds without a false conflict', async () => {
            const filePath = path('regression-101.md');
            await ctx.service.pushFile(filePath, 'v1', ctx.branch, 'e2e: create for #101 regression');

            // Simulates a single pull: SyncManager stores both identities from getFile().
            const pulled = await ctx.service.getFile(filePath, ctx.branch);
            expect(pulled.sha).toBeTruthy();
            expect(pulled.revision).toBeTruthy();
            // The two ID spaces are genuinely different values on a real server.
            expect(pulled.sha).not.toBe(pulled.revision);

            // Edit locally, then push exactly as SyncManager.performPush does:
            // existingSha=remote.sha (create/update decision), existingRevision=remote.revision (lock token).
            await ctx.service.pushFile(
                filePath, 'v2 edited locally', ctx.branch, 'e2e: edit for #101 regression', pulled.sha, pulled.revision
            );

            const remote = await ctx.verifier.getFile(filePath, ctx.branch);
            expect(remote?.content).toBe('v2 edited locally');

            const remoteRevisionAfter = await ctx.verifier.getRevision(filePath, ctx.branch);
            // The write must have advanced the revision — proves the push actually
            // went through as an update, not a false-conflict rejection.
            expect(remoteRevisionAfter).not.toBe(pulled.revision);
        });

        it('the fix works: a genuinely stale revision (real concurrent edit) is correctly rejected', async () => {
            const filePath = path('regression-101-real-conflict.md');
            await ctx.service.pushFile(filePath, 'v1', ctx.branch, 'e2e: create for #101 real-conflict test');
            const pulled = await ctx.service.getFile(filePath, ctx.branch);

            // Someone else pushes a concurrent edit before we push ours.
            await ctx.service.pushFile(filePath, 'concurrent edit by someone else', ctx.branch, 'e2e: concurrent edit', pulled.sha, pulled.revision);

            // Our push still carries the pre-concurrent-edit revision — this is a
            // genuine conflict and must be rejected using the real last_commit_id lock.
            await expect(
                ctx.service.pushFile(filePath, 'stale local edit', ctx.branch, 'e2e: stale push should conflict', pulled.sha, pulled.revision)
            ).rejects.toThrow();

            const remote = await ctx.verifier.getFile(filePath, ctx.branch);
            expect(remote?.content).toBe('concurrent edit by someone else');
        });

        it('reproduces the original #101 bug: blob sha as the lock token silently bypasses conflict detection', async () => {
            const filePath = path('regression-101-bug-repro.md');
            await ctx.service.pushFile(filePath, 'v1', ctx.branch, 'e2e: create for #101 bug repro');
            const pulled = await ctx.service.getFile(filePath, ctx.branch);

            // Someone else pushes a concurrent edit before we push ours — same
            // genuine-conflict setup as the previous test.
            await ctx.service.pushFile(filePath, 'concurrent edit by someone else', ctx.branch, 'e2e: concurrent edit', pulled.sha, pulled.revision);

            // The pre-#101-fix behavior: pass blob sha where GitLab expects
            // last_commit_id. This must be a documented characterization, not a
            // desired outcome — it succeeds and silently clobbers the concurrent
            // edit above, which is exactly the data-loss risk the #101 fix closes.
            await expect(
                ctx.service.pushFile(filePath, 'stale local edit using sha as lock token', ctx.branch, 'e2e: regression bug reproduction', pulled.sha, pulled.sha)
            ).resolves.not.toThrow();

            const remote = await ctx.verifier.getFile(filePath, ctx.branch);
            expect(remote?.content).toBe('stale local edit using sha as lock token');
        });

        it('batch push after a pull + local edit does not falsely conflict', async () => {
            const filePath = path('regression-101-batch.md');
            await ctx.service.pushFile(filePath, 'batch v1', ctx.branch, 'e2e: create for #101 batch regression');
            const pulled = await ctx.service.getFile(filePath, ctx.branch);
            expect(pulled.sha).toBeTruthy();

            const results = await ctx.service.pushBatch!(
                [{ path: filePath, content: 'batch v2 edited', existedRemotely: true }],
                ctx.branch,
                'e2e: batch push after pull for #101 regression'
            );
            expect(results).toHaveLength(1);

            const remote = await ctx.verifier.getFile(filePath, ctx.branch);
            expect(remote?.content).toBe('batch v2 edited');
            // Batch results report blob sha, not the commit revision.
            expect(results[0]?.sha).not.toBe(pulled.revision);
        });
    });
});
