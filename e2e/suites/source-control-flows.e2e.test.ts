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
});