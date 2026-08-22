import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createSyncManagerFixture, describePushResult, type SyncManagerFixture } from '../support/sync-manager-fixture';
import { SourceControlScenario, change } from '../support/source-control-scenarios';
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
// behavior that's provider-agnostic. PR/branch CI runs the core tier; GitHub
// main, schedule, manual, and local runs use the full tier. Stress (1000-file)
// remains opt-in via E2E_STRESS=1.
const isGitHub = process.env.E2E_PROVIDER === 'github';
const e2eTier = process.env.E2E_TIER ?? 'full';
const runExtended = isGitHub && e2eTier !== 'core';
const isStress = process.env.E2E_STRESS === '1';

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
        it.skipIf(!runExtended)('moves files across nested directories in one commit', async () => {
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

        it.skipIf(!runExtended)('collapses a rename chain (A->B->C) into a single move of the original path', async () => {
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

        it.skipIf(!runExtended)('overwrites a remotely-created file with local content on a no-baseline add/add (current contract)', async () => {
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

    // ------------------------------------------------------------------
    // Phase 4 — Conflict resolution workflows
    // ------------------------------------------------------------------
    describe('conflict resolution workflows', () => {
        it('resolves a modify/modify conflict with keep-local: remote becomes local, metadata advances', async () => {
            const s = scenario();
            const p = path('resolve-keep-local/a.md');
            await s.baseline(p, 'baseline');
            s.writeLocal(p, 'local edit');
            await s.modifyRemote(p, 'remote edit');

            fixture.setConflictResolver(() => 'keep-local');
            const headBefore = await s.head();
            const result = await s.push([p]);
            expect(result.success, describePushResult(result)).toBe(1);
            expect(result.resolvedConflicts, describePushResult(result)).toBe(1);
            expect(result.skippedConflicts, describePushResult(result)).toBe(0);
            expect(result.failed, describePushResult(result)).toBe(0);

            await s.expectRemoteContent(p, 'local edit');
            expect(await s.readLocal(p)).toBe('local edit');
            const remote = await s.remoteContent(p);
            expect(s.metadataSha(p), 'metadata = new remote sha').toBe(remote?.sha);
            await s.expectSingleCommitSince(headBefore);
        });

        it('resolves a modify/modify conflict with keep-remote: local becomes remote, no remote mutation', async () => {
            const s = scenario();
            const p = path('resolve-keep-remote/a.md');
            await s.baseline(p, 'baseline');
            s.writeLocal(p, 'local edit');
            await s.modifyRemote(p, 'remote edit');

            fixture.setConflictResolver(() => 'keep-remote');
            const headBefore = await s.head();
            const result = await s.push([p]);
            expect(result.failed, describePushResult(result)).toBe(0);
            expect(result.resolvedConflicts, describePushResult(result)).toBe(1);
            expect(result.skippedConflicts, describePushResult(result)).toBe(0);

            await s.expectRemoteContent(p, 'remote edit');
            expect(await s.readLocal(p)).toBe('remote edit');
            const remote = await s.remoteContent(p);
            expect(s.metadataSha(p), 'metadata = remote sha').toBe(remote?.sha);
            // keep-remote is a pull, not a push — no new commit on the branch.
            await s.expectNoCommitSince(headBefore);
        });

        it('regression: skip leaves local, remote, baseline metadata, and HEAD all untouched', async () => {
            const s = scenario();
            const p = path('resolve-skip/a.md');
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
    });

    // ------------------------------------------------------------------
    // Phase 5 — Mixed batch operations
    // ------------------------------------------------------------------
    describe('mixed batch operations', () => {
        it.skipIf(!runExtended)('pushes a create + modify + rename in one commit', async () => {
            const s = scenario();
            const create = path('mixed-cmr/create.md');
            const modify = path('mixed-cmr/modify.md');
            const oldMove = path('mixed-cmr/old.md');
            const newMove = path('mixed-cmr/moved.md');
            await s.baseline(modify, 'm-v1');
            await s.baseline(oldMove, 'move-me');

            s.writeLocal(create, 'create content');
            s.writeLocal(modify, 'm-v2');
            s.renameLocal(oldMove, newMove);
            await s.manager.trackRename(newMove, oldMove);

            const headBefore = await s.head();
            const result = await s.push([create, modify, s.tfile(newMove)]);
            expect(result.success, describePushResult(result)).toBe(3);
            expect(result.failed, describePushResult(result)).toBe(0);

            await s.expectRemoteContent(create, 'create content');
            await s.expectRemoteContent(modify, 'm-v2');
            await s.expectRemoteMissing(oldMove);
            await s.expectRemoteContent(newMove, 'move-me');
            await s.expectSingleCommitSince(headBefore);
        });

        it('pushes create + modify + pure rename + rename-with-modify in one commit', async () => {
            const s = scenario();
            const create = path('mixed-lifecycle/create.md');
            const modify = path('mixed-lifecycle/modify.md');
            const renameOld = path('mixed-lifecycle/rename-old.md');
            const renameNew = path('mixed-lifecycle/rename-new.md');
            const moveOld = path('mixed-lifecycle/move-old.md');
            const moveNew = path('mixed-lifecycle/move-new.md');
            await s.baseline(modify, 'm-v1');
            await s.baseline(renameOld, 'r-v1');
            await s.baseline(moveOld, 'mv-v1');

            s.writeLocal(create, 'create content');
            s.writeLocal(modify, 'm-v2');
            s.renameLocal(renameOld, renameNew);
            await s.manager.trackRename(renameNew, renameOld);
            s.renameLocal(moveOld, moveNew);
            s.writeLocal(moveNew, 'mv-v2');
            await s.manager.trackRename(moveNew, moveOld);

            const headBefore = await s.head();
            const result = await s.push([create, modify, s.tfile(renameNew), s.tfile(moveNew)]);
            expect(result.success, describePushResult(result)).toBe(4);
            expect(result.failed, describePushResult(result)).toBe(0);

            await s.expectRemoteContent(create, 'create content');
            await s.expectRemoteContent(modify, 'm-v2');
            await s.expectRemoteMissing(renameOld);
            await s.expectRemoteContent(renameNew, 'r-v1');
            await s.expectRemoteMissing(moveOld);
            await s.expectRemoteContent(moveNew, 'mv-v2');
            await s.expectSingleCommitSince(headBefore);
        });

        it('locks the current contract for a safe + conflict batch (safe files commit, conflict skipped)', async () => {
            const s = scenario();
            const safe = path('mixed-safe-conflict/a.md');
            const conflict = path('mixed-safe-conflict/b.md');
            const created = path('mixed-safe-conflict/c.md');
            await s.baseline(safe, 'a-v1');
            await s.baseline(conflict, 'b-v1');

            s.writeLocal(safe, 'a-v2');
            s.writeLocal(conflict, 'b-local');
            await s.modifyRemote(conflict, 'b-remote');
            s.writeLocal(created, 'c-new');

            fixture.setConflictResolver(() => 'skip');
            const headBefore = await s.head();
            const result = await s.push([safe, conflict, created]);
            expect(result.success, describePushResult(result)).toBe(2);
            expect(result.failed, describePushResult(result)).toBe(0);
            expect(result.conflicts, describePushResult(result)).toBe(1);
            expect(result.skippedConflicts, describePushResult(result)).toBe(1);

            // Current contract: safe files land in one commit; the conflict is
            // skipped (remote stays 'b-remote'), not atomic. Locked here.
            await s.expectRemoteContent(safe, 'a-v2');
            await s.expectRemoteContent(conflict, 'b-remote');
            await s.expectRemoteContent(created, 'c-new');
            await s.expectSingleCommitSince(headBefore);
        });
    });

    // ------------------------------------------------------------------
    // Phase 6 — Source Control selection workflows
    //
    // Drives the real SourceControlActionService + PushSelectionStore +
    // ChangeRepository on top of the real SyncManager (via the thin
    // BoundarySyncWorkspace), so the ChangeId -> path -> workspace.push
    // selection filter is the real production code, not a mock.
    // ------------------------------------------------------------------
    describe('selection workflows', () => {
        it('pushes only the selected subset, leaving unselected files untouched', async () => {
            const s = scenario();
            const a = path('subset/a.md');
            const b = path('subset/b.md');
            const c = path('subset/c.md');
            await s.baseline(a, 'a-v1');
            await s.baseline(b, 'b-v1');
            await s.baseline(c, 'c-v1');
            s.writeLocal(a, 'a-v2');
            s.writeLocal(b, 'b-v2');
            s.writeLocal(c, 'c-v2');

            const ca = change(a, 'local-modified');
            const cb = change(b, 'local-modified');
            const cc = change(c, 'local-modified');
            const { selection, actionService, operations } = s.selectionStack([ca, cb, cc]);
            selection.includeForPush(ca.id);
            selection.includeForPush(cc.id);

            const headBefore = await s.head();
            await actionService.push([ca.id, cc.id]);

            expect(operations.get(ca.id)).toBe('success');
            expect(operations.get(cc.id)).toBe('success');
            expect(operations.get(cb.id), 'unselected change stays idle').toBe('idle');
            await s.expectRemoteContent(a, 'a-v2');
            await s.expectRemoteContent(c, 'c-v2');
            await s.expectRemoteContent(b, 'b-v1');
            await s.expectSingleCommitSince(headBefore);
            // Current contract: the action service marks operations but does
            // not clear selection or refresh the repository, so the selection
            // is retained (locked here).
            expect(selection.isIncluded(ca.id)).toBe(true);
            expect(selection.isIncluded(cc.id)).toBe(true);
        });

        it.skipIf(!runExtended)('pushes a subset then the remaining subset as two separate commits', async () => {
            const s = scenario();
            const a = path('subset-then-rest/a.md');
            const b = path('subset-then-rest/b.md');
            const c = path('subset-then-rest/c.md');
            await s.baseline(a, 'a-v1');
            await s.baseline(b, 'b-v1');
            await s.baseline(c, 'c-v1');
            s.writeLocal(a, 'a-v2');
            s.writeLocal(b, 'b-v2');
            s.writeLocal(c, 'c-v2');

            const ca = change(a, 'local-modified');
            const cb = change(b, 'local-modified');
            const cc = change(c, 'local-modified');
            const { selection, actionService, operations } = s.selectionStack([ca, cb, cc]);

            const head0 = await s.head();
            selection.includeForPush(ca.id);
            selection.includeForPush(cc.id);
            await actionService.push([ca.id, cc.id]);
            const head1 = await s.head();
            await s.expectSingleCommitSince(head0);

            selection.includeForPush(cb.id);
            await actionService.push([cb.id]);
            const head2 = await s.head();
            expect(head2, 'second push is a separate commit').not.toBe(head1);
            const [, head2Parent] = await s.listCommitShas(2);
            expect(head2Parent).toBe(head1);

            expect(operations.get(ca.id)).toBe('success');
            expect(operations.get(cb.id)).toBe('success');
            expect(operations.get(cc.id)).toBe('success');
            await s.expectRemoteContent(a, 'a-v2');
            await s.expectRemoteContent(b, 'b-v2');
            await s.expectRemoteContent(c, 'c-v2');
        });

        it.skipIf(!runExtended)('rename yields a path-derived ChangeId; selecting the new id pushes the move', async () => {
            const s = scenario();
            const oldP = path('selection-rename/a.md');
            const newP = path('selection-rename/archive/a.md');
            await s.baseline(oldP, 'v1');

            s.renameLocal(oldP, newP);
            await s.manager.trackRename(newP, oldP);

            // Current model: ChangeId is path-derived, so the moved change
            // carries a NEW id (the new path) with previousPath set; the old
            // path's id is gone. Locking this assumption protects the status
            // model against an accidental path->identity regression.
            const moved = change(newP, 'moved', oldP);
            const { selection, actionService, operations } = s.selectionStack([moved]);
            selection.refresh([moved.id]);
            selection.includeForPush(moved.id);

            const headBefore = await s.head();
            await actionService.push([moved.id]);

            expect(operations.get(moved.id)).toBe('success');
            await s.expectRemoteMissing(oldP);
            await s.expectRemoteContent(newP, 'v1');
            await s.expectSingleCommitSince(headBefore);
        });
    });

    // ------------------------------------------------------------------
    // Phase 6b — Download (remote-only) action
    //
    // The Download button / Sync-Queue download routing both resolve to
    // SourceControlActionService.pull, which runs the real manager.pullAllFiles
    // through BoundarySyncWorkspace. This locks the end-to-end primitive: a
    // remote-only change (file exists on remote, absent locally) downloads
    // into the vault and advances metadata to the remote sha.
    // ------------------------------------------------------------------
    describe('download (remote-only) action', () => {
        it('downloads a remote-only change into the vault via actionService.pull, advancing metadata', async () => {
            const s = scenario();
            const p = path('download-remote-only/a.md');
            await s.seedRemote(p, 'remote-content');

            expect(s.localExists(p), 'no local file before download').toBe(false);

            const remote = change(p, 'remote-only');
            const { actionService, operations } = s.selectionStack([remote]);

            await actionService.pull([remote.id]);

            expect(operations.get(remote.id)).toBe('success');
            expect(s.localExists(p), 'local file created by download').toBe(true);
            expect(await s.readLocal(p)).toBe('remote-content');
            const remoteMeta = await s.remoteContent(p);
            expect(s.metadataSha(p), 'metadata advances to the remote sha').toBe(remoteMeta?.sha);
        });

        it.skipIf(!runExtended)('download leaves an unrelated local-only change untouched (no cross-contamination)', async () => {
            const s = scenario();
            const remote = path('download-isolation/remote.md');
            const local = path('download-isolation/local.md');
            await s.seedRemote(remote, 'remote-content');
            s.writeLocal(local, 'local-only-content');

            const remoteChange = change(remote, 'remote-only');
            const localChange = change(local, 'local-only');
            const { actionService, operations } = s.selectionStack([remoteChange, localChange]);

            await actionService.pull([remoteChange.id]);

            expect(operations.get(remoteChange.id)).toBe('success');
            expect(operations.get(localChange.id), 'local-only change stays idle').toBe('idle');
            expect(await s.readLocal(remote)).toBe('remote-content');
            expect(await s.readLocal(local)).toBe('local-only-content');
        });
    });

    // ------------------------------------------------------------------
    // Phase 7 — Remote divergence + idempotency
    // ------------------------------------------------------------------
    describe('divergence and idempotency flows', () => {
        it('pulls a remote-ahead update into a synced-baseline local, advancing metadata', async () => {
            const s = scenario();
            const p = path('remote-ahead/a.md');
            await s.baseline(p, 'A');
            await s.modifyRemote(p, 'B');

            await s.pullFile(p);

            expect(await s.readLocal(p)).toBe('B');
            const remote = await s.remoteContent(p);
            expect(s.metadataSha(p), 'metadata moves to the remote sha').toBe(remote?.sha);
        });

        it.skipIf(!isGitHub)('a remote-ahead change and an unrelated local change coexist', async () => {
            const s = scenario();
            const a = path('coexist/a.md');
            const b = path('coexist/b.md');
            await s.baseline(a, 'A');
            await s.baseline(b, 'B');

            await s.modifyRemote(a, 'A-remote');
            s.writeLocal(b, 'B-local');

            await s.pullFile(a);
            expect(await s.readLocal(a)).toBe('A-remote');
            // The local change on b survives the pull of a — no cross-contamination.
            expect(await s.readLocal(b)).toBe('B-local');
            await s.expectRemoteContent(b, 'B');
        });

        it.skipIf(!isGitHub)('a concurrent remote write surfaces as a conflict, then reconciles with no lost update', async () => {
            const s = scenario();
            const p = path('concurrent/a.md');
            await s.baseline(p, 'v1');
            s.writeLocal(p, 'local-v2');
            await s.modifyRemote(p, 'concurrent-v2');

            fixture.setConflictResolver(() => 'skip');
            const skipped = await s.push([p]);
            expect(skipped.skippedConflicts, describePushResult(skipped)).toBeGreaterThanOrEqual(1);
            await s.expectRemoteContent(p, 'concurrent-v2');

            // Reconcile: accept the concurrent remote, then push a fresh local edit.
            fixture.setConflictResolver(() => 'keep-remote');
            await s.push([p]);
            expect(await s.readLocal(p)).toBe('concurrent-v2');

            s.writeLocal(p, 'final');
            const headBefore = await s.head();
            const finalResult = await s.push([p]);
            expect(finalResult.success, describePushResult(finalResult)).toBe(1);
            await s.expectRemoteContent(p, 'final');
            await s.expectSingleCommitSince(headBefore);
        });

        it('an all-unchanged batch reports no work and creates zero commits', async () => {
            const s = scenario();
            const a = path('noop-batch/a.md');
            const b = path('noop-batch/b.md');
            const c = path('noop-batch/c.md');
            await s.baseline(a, 'a');
            await s.baseline(b, 'b');
            await s.baseline(c, 'c');

            const headBefore = await s.head();
            const result = await s.push([a, b, c]);
            expect(result.success, describePushResult(result)).toBe(0);
            expect(result.failed, describePushResult(result)).toBe(0);
            expect(result.skippedConflicts, describePushResult(result)).toBe(0);
            await s.expectNoCommitSince(headBefore);
        });

        it.skipIf(!isGitHub)('repeating the same push twice makes no second mutation and corrupts no metadata', async () => {
            const s = scenario();
            const p = path('repeat-push/a.md');
            await s.baseline(p, 'v1');
            s.writeLocal(p, 'v2');

            const first = await s.push([p]);
            expect(first.success, describePushResult(first)).toBe(1);
            await s.expectRemoteContent(p, 'v2');
            const shaAfterFirst = s.metadataSha(p);
            expect(shaAfterFirst).toBeTruthy();
            const headAfterFirst = await s.head();

            const second = await s.push([p]);
            expect(second.success, describePushResult(second)).toBe(0);
            expect(second.failed, describePushResult(second)).toBe(0);
            await s.expectNoCommitSince(headAfterFirst);
            expect(s.metadataSha(p), 'metadata not corrupted by the no-op repeat').toBe(shaAfterFirst);
        });

        it.skipIf(!runExtended)('re-syncs cleanly after a skipped conflict (no stale operation state)', async () => {
            const s = scenario();
            const p = path('retry-after-skip/a.md');
            await s.baseline(p, 'v1');
            s.writeLocal(p, 'local');
            await s.modifyRemote(p, 'remote');

            fixture.setConflictResolver(() => 'skip');
            const skipped = await s.push([p]);
            expect(skipped.skippedConflicts, describePushResult(skipped)).toBeGreaterThanOrEqual(1);

            // Resolve the skipped conflict (keep-remote), then push a fresh edit.
            fixture.setConflictResolver(() => 'keep-remote');
            await s.push([p]);
            expect(await s.readLocal(p)).toBe('remote');

            s.writeLocal(p, 'reconciled');
            const headBefore = await s.head();
            const result = await s.push([p]);
            expect(result.success, describePushResult(result)).toBe(1);
            expect(result.failed, describePushResult(result)).toBe(0);
            await s.expectRemoteContent(p, 'reconciled');
            await s.expectSingleCommitSince(headBefore);
        });
    });

    // ------------------------------------------------------------------
    // Phase 8 — Path edge cases + batch scale
    // ------------------------------------------------------------------
    describe('path edge cases and batch scale', () => {
        it.skipIf(!runExtended)('creates, modifies, and renames a unicode-named file', async () => {
            const s = scenario();
            const original = path('unicode/筆記/測試文件.md');
            const archived = path('unicode/筆記/已歸檔.md');
            await s.baseline(original, 'unicode-v1');

            s.writeLocal(original, 'unicode-v2');
            let headBefore = await s.head();
            let result = await s.push([original]);
            expect(result.success, describePushResult(result)).toBe(1);
            await s.expectRemoteContent(original, 'unicode-v2');
            await s.expectSingleCommitSince(headBefore);

            s.renameLocal(original, archived);
            await s.manager.trackRename(archived, original);
            headBefore = await s.head();
            result = await s.push([s.tfile(archived)]);
            expect(result.success, describePushResult(result)).toBe(1);
            await s.expectRemoteMissing(original);
            await s.expectRemoteContent(archived, 'unicode-v2');
            await s.expectSingleCommitSince(headBefore);
        });

        it.skipIf(!runExtended)('creates and modifies a file with spaces and symbols', async () => {
            const s = scenario();
            const p = path('spaces/folder/my note (draft).md');
            await s.baseline(p, 'draft-v1');

            s.writeLocal(p, 'draft-v2');
            const headBefore = await s.head();
            const result = await s.push([p]);
            expect(result.success, describePushResult(result)).toBe(1);
            await s.expectRemoteContent(p, 'draft-v2');
            await s.expectSingleCommitSince(headBefore);
        });

        it.skipIf(!runExtended)('moves and modifies a deeply nested file', async () => {
            const s = scenario();
            const oldP = path('deep/a/b/c/d/e/note.md');
            const newP = path('deep/archive/x/y/z/w/note.md');
            await s.baseline(oldP, 'deep-v1');

            s.renameLocal(oldP, newP);
            s.writeLocal(newP, 'deep-v2');
            await s.manager.trackRename(newP, oldP);

            const headBefore = await s.head();
            const result = await s.push([s.tfile(newP)]);
            expect(result.success, describePushResult(result)).toBe(1);
            await s.expectRemoteMissing(oldP);
            await s.expectRemoteContent(newP, 'deep-v2');
            await s.expectSingleCommitSince(headBefore);
        });

        it.skipIf(!runExtended)('creates 100 files in one commit', async () => {
            const s = scenario();
            const paths = Array.from({ length: 100 }, (_, i) => path(`batch-100/${String(i).padStart(3, '0')}.md`));
            for (const p of paths) s.writeLocal(p, `content ${p}`);

            const headBefore = await s.head();
            const result = await s.push(paths);
            expect(result.success, describePushResult(result)).toBe(100);
            expect(result.failed, describePushResult(result)).toBe(0);
            await s.expectSingleCommitSince(headBefore);
            await s.expectRemoteContent(paths[0]!, `content ${paths[0]}`);
            await s.expectRemoteContent(paths[50]!, `content ${paths[50]}`);
            await s.expectRemoteContent(paths[99]!, `content ${paths[99]}`);
        });

        it.skipIf(!runExtended)('pushes a 100-file mixed batch (modify + create + rename) in one commit', async () => {
            const s = scenario();
            const modifyPaths = Array.from({ length: 40 }, (_, i) => path(`mixed-100/modify/${i}.md`));
            const createPaths = Array.from({ length: 30 }, (_, i) => path(`mixed-100/create/${i}.md`));
            const renameOld = Array.from({ length: 30 }, (_, i) => path(`mixed-100/rename-old/${i}.md`));
            const renameNew = Array.from({ length: 30 }, (_, i) => path(`mixed-100/rename-new/${i}.md`));

            for (const p of modifyPaths) await s.baseline(p, 'v1');
            for (const p of renameOld) await s.baseline(p, 'r-v1');
            for (const p of modifyPaths) s.writeLocal(p, 'v2');
            for (const p of createPaths) s.writeLocal(p, 'new');
            for (let i = 0; i < renameOld.length; i++) {
                s.renameLocal(renameOld[i]!, renameNew[i]!);
                await s.manager.trackRename(renameNew[i]!, renameOld[i]!);
            }

            const headBefore = await s.head();
            const all = [...modifyPaths, ...createPaths, ...renameNew.map(p => s.tfile(p))];
            const result = await s.push(all);
            expect(result.success, describePushResult(result)).toBe(100);
            expect(result.failed, describePushResult(result)).toBe(0);
            await s.expectSingleCommitSince(headBefore);

            await s.expectRemoteContent(modifyPaths[0]!, 'v2');
            await s.expectRemoteContent(createPaths[0]!, 'new');
            await s.expectRemoteMissing(renameOld[0]!);
            await s.expectRemoteContent(renameNew[0]!, 'r-v1');
        });

        it.skipIf(!isStress || !runExtended)('stress: creates 1000 files', async () => {
            const s = scenario();
            const paths = Array.from({ length: 1000 }, (_, i) => path(`batch-1000/${String(i).padStart(4, '0')}.md`));
            for (const p of paths) s.writeLocal(p, `content ${p}`);

            const result = await s.push(paths);
            expect(result.success, describePushResult(result)).toBe(1000);
            expect(result.failed, describePushResult(result)).toBe(0);
            await s.expectRemoteContent(paths[0]!, `content ${paths[0]}`);
            await s.expectRemoteContent(paths[999]!, `content ${paths[999]}`);
        }, 300_000);
    });
});