import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createSyncManagerFixture, describePushResult, type SyncManagerFixture } from '../support/sync-manager-fixture';
import { SourceControlScenario } from '../support/source-control-scenarios';
import { timeouts } from '../config/env';

// Auto-confirm the plan-review + conflict modals so a push can proceed
// without a human. vi.mock is hoisted above the fixture import, so the fixture
// receives the mocked modules and installs their mockImplementation. Pull-side
// SyncConflictModal stays the bare automock default (does nothing, matching
// production: pullFile returns before the conflict modal resolves).
vi.mock('../../src/ui/SyncPlanModal');
vi.mock('../../src/ui/SyncConflictModal');
vi.mock('../../src/ui/BatchConflictResolutionModal');

// Provider matrix: Core scenarios run on every provider; Extended scenarios
// (rename chains, unicode, batch-scale, etc.) exercise SyncManager/model
// behavior that's provider-agnostic, so they run on GitHub only to keep
// real-API CI fast and stable.
const isGitHub = process.env.E2E_PROVIDER === 'github';

describe('Source Control Flows E2E', () => {
    let fixture: SyncManagerFixture;

    beforeAll(async () => {
        fixture = await createSyncManagerFixture();
    }, timeouts.containerReadyMs + 30_000);

    const path = (name: string): string => fixture.path(name);
    const scenario = (): SourceControlScenario => new SourceControlScenario(fixture);

    // ------------------------------------------------------------------
    // Phase 2 — Rename / Move workflows
    // ------------------------------------------------------------------
    describe('rename and move workflows', () => {
        it('renames and modifies a file in one commit, moving metadata to the new path', async () => {
            const s = scenario();
            const oldP = path('rename-modify/a.md');
            const newP = path('rename-modify/archive/a.md');
            await s.baseline(oldP, 'v1');
            expect(s.metadataSha(oldP), 'baseline metadata at old path').toBeTruthy();

            s.renameLocal(oldP, newP);
            s.writeLocal(newP, 'v2');
            await s.manager.trackRename(newP, oldP);

            const headBefore = await s.head();
            const result = await s.push([s.tfile(newP)]);
            expect(result.success, describePushResult(result)).toBe(1);
            expect(result.failed, describePushResult(result)).toBe(0);

            await s.expectRemoteMissing(oldP);
            await s.expectRemoteContent(newP, 'v2');
            await s.expectSingleCommitSince(headBefore);
            expect(s.metadataSha(newP), 'metadata moved to new path').toBeTruthy();
            expect(s.metadata(oldP), 'old path metadata removed').toBeUndefined();
        });

        it('renames and modifies multiple files in one batch push (one commit)', async () => {
            const s = scenario();
            const oldA = path('multi-rename/folder/a.md');
            const oldB = path('multi-rename/folder/b.md');
            const newA = path('multi-rename/archive/a.md');
            const newB = path('multi-rename/archive/b.md');
            await s.baseline(oldA, 'a-v1');
            await s.baseline(oldB, 'b-v1');

            s.renameLocal(oldA, newA);
            s.writeLocal(newA, 'a-v2');
            s.renameLocal(oldB, newB);
            s.writeLocal(newB, 'b-v2');
            await s.manager.trackRename(newA, oldA);
            await s.manager.trackRename(newB, oldB);

            const headBefore = await s.head();
            const result = await s.push([s.tfile(newA), s.tfile(newB)]);
            expect(result.success, describePushResult(result)).toBe(2);
            expect(result.failed, describePushResult(result)).toBe(0);

            await s.expectRemoteMissing(oldA);
            await s.expectRemoteMissing(oldB);
            await s.expectRemoteContent(newA, 'a-v2');
            await s.expectRemoteContent(newB, 'b-v2');
            await s.expectSingleCommitSince(headBefore);
        });

        // Extended: nested move + rename chain (SyncManager/model behavior,
        // provider-agnostic) — GitHub only.
        it.skipIf(!isGitHub)('moves files across nested directories in one commit', async () => {
            const s = scenario();
            const oldFlat = path('nested-move/folder/a.md');
            const oldNested = path('nested-move/folder/nested/b.md');
            const newFlat = path('nested-move/archive/a.md');
            const newNested = path('nested-move/archive/nested/b.md');
            await s.baseline(oldFlat, 'flat');
            await s.baseline(oldNested, 'nested');

            s.renameLocal(oldFlat, newFlat);
            s.renameLocal(oldNested, newNested);
            await s.manager.trackRename(newFlat, oldFlat);
            await s.manager.trackRename(newNested, oldNested);

            const headBefore = await s.head();
            const result = await s.push([s.tfile(newFlat), s.tfile(newNested)]);
            expect(result.success, describePushResult(result)).toBe(2);
            expect(result.failed, describePushResult(result)).toBe(0);

            await s.expectRemoteMissing(oldFlat);
            await s.expectRemoteMissing(oldNested);
            await s.expectRemoteContent(newFlat, 'flat');
            await s.expectRemoteContent(newNested, 'nested');
            await s.expectSingleCommitSince(headBefore);
        });

        it.skipIf(!isGitHub)('collapses a rename chain (A->B->C) into a single move of the original path', async () => {
            const s = scenario();
            const a = path('rename-chain/a.md');
            const b = path('rename-chain/b.md');
            const c = path('rename-chain/c.md');
            await s.baseline(a, 'chain');

            s.renameLocal(a, b);
            await s.manager.trackRename(b, a);
            s.renameLocal(b, c);
            await s.manager.trackRename(c, b);

            const headBefore = await s.head();
            const result = await s.push([s.tfile(c)]);
            expect(result.success, describePushResult(result)).toBe(1);
            expect(result.failed, describePushResult(result)).toBe(0);

            await s.expectRemoteMissing(a);
            await s.expectRemoteMissing(b);
            await s.expectRemoteContent(c, 'chain');
            await s.expectSingleCommitSince(headBefore);
            expect(s.metadata(a), 'no stale metadata at intermediate path A').toBeUndefined();
            expect(s.metadata(b), 'no stale metadata at intermediate path B').toBeUndefined();
            expect(s.metadataSha(c), 'metadata landed at final path').toBeTruthy();
        });
    });

    // ------------------------------------------------------------------
    // Phase 3 — Conflict state transitions
    //
    // The current SyncPlanner only surfaces a conflict on a push when both
    // sides diverged from a *stored* baseline (modify/modify with a base
    // sha). No-baseline add/add, delete-side divergence, and a move whose
    // *source* was remotely edited are NOT conflicts today — they resolve to
    // local-wins / blind-recreate / move-drops-old-edit. These tests lock
    // that current contract (per the agreed scope: no production behavior
    // changed to satisfy tests) so a future change to surface those as
    // conflicts is an intentional, test-updating decision. The one real
    // conflict (modify/modify with baseline) is asserted as a conflict.
    // ------------------------------------------------------------------
    describe('conflict state transitions', () => {
        it('detects a modify/modify conflict and leaves both sides + baseline untouched on skip', async () => {
            const s = scenario();
            const p = path('conflict-modify-modify/a.md');
            await s.baseline(p, 'baseline');
            const baselineMeta = s.metadata(p);

            s.writeLocal(p, 'local edit');
            await s.modifyRemote(p, 'remote edit');

            fixture.setConflictResolver(() => 'skip');
            const headBefore = await s.head();
            const result = await s.push([p]);

            expect(result.skippedConflicts, describePushResult(result)).toBeGreaterThanOrEqual(1);
            expect(result.success, describePushResult(result)).toBe(0);
            expect(result.failed, describePushResult(result)).toBe(0);
            await s.expectRemoteContent(p, 'remote edit');
            expect(await s.readLocal(p)).toBe('local edit');
            expect(s.metadata(p)).toEqual(baselineMeta);
            await s.expectNoCommitSince(headBefore);
        });

        it('does not auto-delete a remotely-modified file when its local copy is gone (current push contract)', async () => {
            const s = scenario();
            const gone = path('conflict-delete-modify/a.md');
            const other = path('conflict-delete-modify/b.md');
            await s.baseline(gone, 'baseline');
            await s.baseline(other, 'other-baseline');
            const baselineSha = s.metadataSha(gone);

            s.deleteLocal(gone);
            await s.modifyRemote(gone, 'remote edit');
            s.writeLocal(other, 'other-modified');

            const headBefore = await s.head();
            const result = await s.push([other]);
            expect(result.success, describePushResult(result)).toBe(1);
            expect(result.failed, describePushResult(result)).toBe(0);

            // pushFiles never propagates a local deletion, so the
            // remotely-modified file survives and its baseline metadata is
            // not advanced. No conflict is surfaced for delete/modify today.
            await s.expectRemoteContent(gone, 'remote edit');
            expect(s.metadataSha(gone), 'metadata not falsely advanced').toBe(baselineSha);
            await s.expectRemoteContent(other, 'other-modified');
            await s.expectSingleCommitSince(headBefore);
        });

        it('re-creates a remotely-deleted file from a modified local copy (current push contract)', async () => {
            const s = scenario();
            const p = path('conflict-modify-delete/a.md');
            await s.baseline(p, 'baseline');
            const baselineSha = s.metadataSha(p);

            s.writeLocal(p, 'local edit');
            await s.deleteRemoteFile(p);

            const headBefore = await s.head();
            const result = await s.push([p]);
            expect(result.success, describePushResult(result)).toBe(1);
            expect(result.failed, describePushResult(result)).toBe(0);

            // A remote deletion + local modification classifies as
            // 'local-only' (push-create): the remote is blindly re-created
            // with local content and metadata advances. No conflict today.
            await s.expectRemoteContent(p, 'local edit');
            await s.expectSingleCommitSince(headBefore);
            expect(s.metadataSha(p), 'metadata advanced to new sha').not.toBe(baselineSha);
            expect(s.metadataSha(p)).toBeTruthy();
        });

        it.skipIf(!isGitHub)('a move whose source was remotely edited proceeds, dropping the old-path edit (current contract)', async () => {
            const s = scenario();
            const oldP = path('conflict-rename-modify/a.md');
            const newP = path('conflict-rename-modify/archive/a.md');
            await s.baseline(oldP, 'v1');

            s.renameLocal(oldP, newP);
            await s.manager.trackRename(newP, oldP);
            await s.modifyRemote(oldP, 'remote edit on old path');

            const headBefore = await s.head();
            const result = await s.push([s.tfile(newP)]);
            expect(result.success, describePushResult(result)).toBe(1);
            expect(result.failed, describePushResult(result)).toBe(0);

            // planMove only flags a conflict when the DESTINATION is occupied.
            // A diverged source (old path remotely edited) is a plain move, so
            // the old-path edit is dropped (old path deleted, new path created
            // with local content). Locked here as the current contract.
            await s.expectRemoteMissing(oldP);
            await s.expectRemoteContent(newP, 'v1');
            await s.expectSingleCommitSince(headBefore);
        });

        it.skipIf(!isGitHub)('overwrites a remotely-created file with local content on a no-baseline add/add (current contract)', async () => {
            const s = scenario();
            const p = path('conflict-add-add/a.md');
            await s.seedRemote(p, 'remote');
            s.writeLocal(p, 'local');

            const headBefore = await s.head();
            const result = await s.push([p]);
            expect(result.success, describePushResult(result)).toBe(1);
            expect(result.failed, describePushResult(result)).toBe(0);
            expect(result.skippedConflicts, describePushResult(result)).toBe(0);

            // A no-baseline two-sided diff downgrades to 'local-modified' on
            // push (classifyForOperation), so local overwrites remote with no
            // conflict surfaced. Locked here as the current contract.
            await s.expectRemoteContent(p, 'local');
            await s.expectSingleCommitSince(headBefore);
        });
    });
});