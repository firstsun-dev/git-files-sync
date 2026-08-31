import { describe, it, expect, beforeAll, vi } from 'vitest';
import { BatchConflictResolutionModal } from '../../src/ui/BatchConflictResolutionModal';
import { createSyncManagerFixture, type SyncManagerFixture } from '../support/sync-manager-fixture';
import { TwoClientSyncScenario } from '../support/two-client-sync-scenario';
import {
    convergenceContext,
    expectTwoClientConvergence,
    expectIdempotent,
    expectNoSilentDataLoss,
    type ConvergenceContext,
} from '../support/convergence-assertions';
import type { BatchPushConflict, ConflictResolution } from '../../src/logic/sync/types';
import { timeouts } from '../config/env';

// Same modal auto-confirm pattern as the other e2e suites: plan-review and
// push-side conflicts resolve without a human, steered per test through
// fixture.setConflictResolver. Pull-side SyncConflictModal stays the bare
// automock (does nothing — matching production: pullFile returns before the
// modal resolves).
vi.mock('../../src/ui/SyncPlanModal');
vi.mock('../../src/ui/SyncConflictModal');
vi.mock('../../src/ui/BatchConflictResolutionModal');

/**
 * Multi-client Sync E2E — two fully independent clients (A/B: separate
 * FakeVaults, separate syncMetadata stores, separate SyncManagers, separate
 * Source Control stacks) syncing against ONE shared real provider branch.
 * Validates the cross-device convergence contract: neither client may
 * silently destroy the other's synced work, and converged state must stay
 * converged under repeated syncs.
 *
 * Production-code rule for this suite: tests define the safety contract; if a
 * RED here proves a production data-loss bug, that's a follow-up
 * `fix(sync): ...` — never a weakened assertion.
 */
describe('Two-client sync E2E', () => {
    let fixture: SyncManagerFixture;
    let setResolver: (resolution: ConflictResolution) => void;

    beforeAll(async () => {
        fixture = await createSyncManagerFixture();
        setResolver = (resolution: ConflictResolution): void => {
            fixture.setConflictResolver(() => resolution);
        };
        setResolver('skip');
    }, timeouts.containerReadyMs + 30_000);

    const scenario = (): TwoClientSyncScenario => TwoClientSyncScenario.from({
        service: fixture.service,
        branch: fixture.branch,
        verifier: fixture.verifier,
        TFile: fixture.TFile,
        runId: fixture.runId,
        newVault: () => fixture.createVault(),
        newSettings: () => fixture.makeSettings(),
        newManager: (vault, settings) => fixture.newManager(vault, settings),
        conflictResolver: () => fixture.conflictResolver(),
    });

    // --- P0-1: normal round-trip convergence -------------------------------

    it('P0-1: A→B→A round-trip converges local trees, remote tree, metadata, and stays idempotent', async () => {
        const s = scenario();
        const file = s.path('p0-1/round-trip.md');
        const other = s.path('p0-1/another.md');
        const ctx: ConvergenceContext = convergenceContext([s.a, s.b], fixture.verifier, fixture.branch, `e2e-tc-${fixture.runId}/p0-1/`);

        await s.baseline(file, 'v1');
        await s.baseline(other, 'other-v1');

        // A edits and syncs; B then pulls.
        s.a.write(file, 'A edit v2');
        await s.a.sync();
        await s.b.sync();

        // B edits; A pulls.
        s.b.write(file, 'B edit v3');
        await s.b.sync();
        await s.a.sync();

        // A creates a new file; B pulls it.
        s.a.write(other, 'A new file');
        await s.a.sync();
        await s.b.sync();

        await expectTwoClientConvergence(ctx);
        await s.expectRemoteContent(file, 'B edit v3');
        await s.expectRemoteContent(other, 'A new file');
        await expectIdempotent(ctx);
        await expectTwoClientConvergence(ctx);
    });

    // --- P0-2: concurrent edits on DIFFERENT files must both survive ------

    it('P0-2: concurrent different-file edits merge without either client clobbering the other', async () => {
        const s = scenario();
        const fileA = s.path('p0-2/a.md');
        const fileB = s.path('p0-2/b.md');
        const ctx: ConvergenceContext = convergenceContext([s.a, s.b], fixture.verifier, fixture.branch, `e2e-tc-${fixture.runId}/p0-2/`);

        await s.baseline(fileA, 'a-v1');
        await s.baseline(fileB, 'b-v1');

        // Both clients diverge on unrelated files while stale on the other's.
        s.a.write(fileA, 'a-v2 by A');
        s.b.write(fileB, 'b-v2 by B');

        await s.a.sync();
        await s.b.sync();
        await s.a.sync();

        await expectTwoClientConvergence(ctx);
        await s.expectRemoteContent(fileA, 'a-v2 by A');
        await s.expectRemoteContent(fileB, 'b-v2 by B');
        await expectIdempotent(ctx);
        await expectTwoClientConvergence(ctx);
    });

    // --- P0-3: same-file modify/modify conflict ----------------------------

    it('P0-3: modify/modify conflict with skip keeps remote, keeps local content, and does not falsely mark synced', async () => {
        const s = scenario();
        const file = s.path('p0-3/note.md');
        const ctx: ConvergenceContext = convergenceContext([s.a, s.b], fixture.verifier, fixture.branch, `e2e-tc-${fixture.runId}/p0-3/`);

        await s.baseline(file, 'v1');
        const baselineShaB = s.b.metadataSha(file);

        // Both sides edit from the shared baseline.
        s.a.write(file, 'A-v2');
        s.b.write(file, 'B-v2');

        setResolver('skip');
        await s.a.sync(); // lands A-v2 on the remote
        await s.b.sync(); // B must see a conflict, not a silent push or pull

        // The conflict modal must actually have been shown to B.
        expect(vi.mocked(BatchConflictResolutionModal).mock.calls.length).toBeGreaterThanOrEqual(1);
        const lastConflictCall = vi.mocked(BatchConflictResolutionModal).mock.calls[vi.mocked(BatchConflictResolutionModal).mock.calls.length - 1];
        const conflictedPaths = (lastConflictCall?.[2] as BatchPushConflict[] | undefined)?.map(conflict => conflict.path) ?? [];
        expect(conflictedPaths).toContain(file);

        // Safety contract under 'skip': remote untouched, B keeps its local
        // edit, B's metadata stays at the baseline (never falsely marked
        // synced), and B's edit has not vanished (data-loss invariant).
        await s.expectRemoteContent(file, 'A-v2');
        expect(await s.b.read(file)).toBe('B-v2');
        expect(s.b.metadataSha(file), 'B metadata must stay at baseline after a skipped conflict').toBe(baselineShaB);
        await expectNoSilentDataLoss(ctx, [{ path: file, content: 'B-v2' }]);
    });

    // --- P0-4: delete vs modify must not silently lose content -------------

    it('P0-4: delete on A + modify on B must not silently destroy B content (conflict or explicit outcome, never silent loss)', async () => {
        const s = scenario();
        const file = s.path('p0-4/a.md');

        await s.baseline(file, 'v1');

        // A deletes the file; B edits it. Both start from the same baseline.
        s.a.delete(file);
        s.b.write(file, 'B-v2 survives?');

        // The whole point of this test is what production does here — do NOT
        // steer the resolver away from its default; the safety assertion below
        // holds for ANY resolution path (skip/keep-local/keep-remote).
        await s.a.sync(); // deletion lands on the remote
        await s.b.sync(); // B, whose baseline says the file exists, must surface the divergence

        // SAFETY INVARIANT (not a semantic choice): whatever conflict policy
        // production picked, B's new content must not have silently vanished.
        // Legitimate outcomes: conflict row left pending on B, or content
        // present remotely/locally after an explicit resolution.
        const remote = await s.remoteContent(file);
        const stillOnRemote = remote?.content === 'B-v2 survives?';
        const inB = s.b.exists(file) && (await s.b.read(file)) === 'B-v2 survives?';
        const pendingOnB = s.b.statusesNow().some(status => status.path === file && status.status !== 'synced');
        expect(stillOnRemote || inB || pendingOnB, [
            'delete/modify produced silent data loss:',
            `remote=${JSON.stringify(remote?.content)}`,
            `B has file=${s.b.exists(file)}`,
            `B statuses=${JSON.stringify(s.b.statusesNow().map(status => `${status.path}:${status.status}`))}`,
        ].join(' ')).toBe(true);
    });

    // --- P0-5: rename on A vs modify of the old path on B ------------------

    it('P0-5: rename a→archive/a on A vs modify of notes/a.md on B must not silently drop B edit or resurrect stale data', async () => {
        const s = scenario();
        const oldPath = s.path('p0-5/notes/a.md');
        const newPath = s.path('p0-5/archive/a.md');

        await s.baseline(oldPath, 'v1');

        // A moves the file (unmodified content — a pure rename)
        s.a.rename(oldPath, newPath);
        await s.a.trackRename(newPath, oldPath);

        // B modifies the file at the OLD path while still unaware of the move.
        s.b.write(oldPath, 'B-v2');

        // Interleaving under test: B syncs first (pushes B-v2 to old path),
        // then A syncs (rename against a modified source).
        const bSyncPushed = await (async () => {
            await s.b.sync();
            const remote = await s.remoteContent(oldPath);
            return remote?.content === 'B-v2';
        })();
        await s.a.sync();

        // SAFETY INVARIANT (not a semantic choice): B's edit must survive
        // somewhere with its content intact. Forbidden outcomes:
        //  - old path deleted remotely AND new path carrying only stale v1/B
        //    content while B-v2 exists nowhere;
        //  - B-v2 silently reverted to v1 everywhere.
        const remote = await s.remoteContent(oldPath);
        const newRemote = await s.remoteContent(newPath);
        const bEditOnOldRemote = remote?.content === 'B-v2';
        const bEditOnNewRemote = newRemote?.content === 'B-v2';
        const bEditInB = s.b.exists(oldPath) && (await s.b.read(oldPath)) === 'B-v2';
        const pendingOnB = s.b.statusesNow().some(status => status.path === oldPath && status.status !== 'synced');
        const staleResurrection = (remote === null && newRemote?.content === 'v1' && !bEditInB && !pendingOnB);
        expect(
            bEditOnOldRemote || bEditOnNewRemote || bEditInB || pendingOnB,
            [
                'rename/modify silently dropped B edit:',
                `bSyncPushed=${bSyncPushed}`,
                `old remote=${JSON.stringify(remote?.content)}`,
                `new remote=${JSON.stringify(newRemote?.content)}`,
                `B statuses=${JSON.stringify(s.b.statusesNow().map(status => `${status.path}:${status.status}`))}`,
            ].join(' '),
        ).toBe(true);
        expect(staleResurrection, 'rename produced the stale-resurrection outcome: old path deleted, new path holds stale v1, B-v2 gone').toBe(false);
    });
});