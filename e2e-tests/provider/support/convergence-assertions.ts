import { expect } from 'vitest';
import type { GitVerifier } from './git-verifier';
import type { TwoClient } from './two-client-sync-scenario';

/**
 * Multi-client safety invariants, expressed once so every two-client test
 * asserts against the same standard instead of hand-rolling per-test checks.
 *
 * All remote reads go through the independent git-CLI verifier — never the
 * provider service under test — so "remote tree" here is ground truth, not
 * the service agreeing with itself.
 */

export interface ConvergenceContext {
    clients: [TwoClient, TwoClient];
    branch: string;
    verifier: GitVerifier;
    /** Only paths under this run's namespace. */
    runPrefix: string;
}

/**
 * The union of local paths across both clients (the paths that must
 * converge), scoped to this run's namespace. A real sync pulls the whole
 * remote tree, so an unscoped union would also pick up every other suite's
 * fixtures on the shared disposable-provider branch.
 */
export async function trackedPaths(context: ConvergenceContext): Promise<string[]> {
    const paths = new Set<string>();
    for (const client of context.clients) {
        for (const path of client.vault.paths()) {
            if (path.startsWith(context.runPrefix)) paths.add(path);
        }
    }
    return [...paths].sort((a, b) => a.localeCompare(b));
}

/**
 * Invariant A — Convergence: after a complete sync cycle,
 * A local tree == B local tree == remote tree for every tracked path
 * (existence, content, and absence all agree).
 */
export async function expectConverged(context: ConvergenceContext): Promise<void> {
    const [clientA, clientB] = context.clients;
    const paths = await trackedPaths(context);
    for (const path of paths) {
        const remote = await context.verifier.getFile(path, context.branch);
        const aHas = clientA.exists(path);
        const bHas = clientB.exists(path);
        expect(aHas, `convergence: ${path} existence A vs B (${aHas} vs ${bHas})`).toBe(bHas);
        const expectedMessage = `convergence: ${path} local vs remote`;
        if (!aHas) {
            expect(remote, expectedMessage).toBeNull();
            continue;
        }
        expect(remote, expectedMessage).not.toBeNull();
        expect(await clientA.read(path), `convergence: ${path} A vs B`).toBe(await clientB.read(path));
        expect(await clientA.read(path), `convergence: ${path} A vs remote`).toBe(remote!.content);
    }
    // Nothing in the run's remote namespace should exist without existing in
    // both local vaults either (catches remote-only surprises like a dropped
    // rename source that left a stale blob behind).
    const remoteFiles = (await context.verifier.listFiles(context.branch))
        .filter(path => path.startsWith(context.runPrefix))
        .sort((a, b) => a.localeCompare(b));
    expect(remoteFiles).toEqual(paths.filter(path => clientA.exists(path)));
}

/**
 * Invariant B — Metadata consistency: every path that exists locally in a
 * client (i.e. was synced, not deliberately local-only) must carry a
 * lastSyncedSha equal to the current remote blob sha — on BOTH clients.
 * Catches "file looks identical but baselines diverged" — the source of the
 * next false conflict or silent overwrite.
 */
export async function expectMetadataConsistent(context: ConvergenceContext): Promise<void> {
    const paths = await trackedPaths(context);
    for (const path of paths) {
        const remote = await context.verifier.getFile(path, context.branch);
        if (!remote) continue;
        for (const client of context.clients) {
            if (!client.exists(path)) continue;
            const meta = client.metadata(path);
            expect(meta?.lastSyncedSha, `metadata: ${client.name} ${path} lastSyncedSha vs remote blob sha`).toBe(remote.sha);
        }
    }
}

/**
 * Invariant C — Clean state: each client's last refresh projects zero pending
 * changes (no modified / unsynced / local-deleted / remote-only / moved /
 * checking rows). Mirrors the Source Control view being empty.
 */
export function expectClean(...clients: TwoClient[]): void {
    for (const client of clients) {
        const pending = client.statusesNow().filter(status => status.status !== 'synced');
        expect(pending, `${client.name} pending changes after convergence`).toEqual([]);
    }
}

/**
 * Invariant D — Idempotency: after convergence, A sync -> B sync -> A sync
 * must produce zero new remote commits. The core anti-ping-pong regression:
 * a stale or diverging baseline would make some client keep "fixing" the
 * remote and rack up commits forever.
 */
export async function expectIdempotent(context: ConvergenceContext): Promise<void> {
    const headBefore = await context.verifier.listCommitShas(context.branch, 1).then(shas => shas[0]!);
    const [clientA, clientB] = context.clients;
    await clientA.sync();
    await clientB.sync();
    await clientA.sync();
    const [headAfter] = await context.verifier.listCommitShas(context.branch, 1);
    expect(headAfter, 'idempotency: repeated syncs must not create commits').toBe(headBefore);
}

/**
 * Invariant E — No silent data loss: asserts that some expected non-baseline
 * content SURVIVED the sync run. `survivors` maps path -> content that some
 * local client held after divergence; each entry must exist somewhere at the
 * end — either as that exact content remotely, or in one of the clients'
 * local vaults (a conflict keeping it locally counts; silent disappearance
 * does not).
 */
export async function expectNoSilentDataLoss(
    context: ConvergenceContext,
    survivors: Array<{ path: string; content: string }>,
): Promise<void> {
    for (const expected of survivors) {
        const remote = await context.verifier.getFile(expected.path, context.branch);
        const inA = context.clients[0].exists(expected.path) && (await context.clients[0].read(expected.path)) === expected.content;
        const inB = context.clients[1].exists(expected.path) && (await context.clients[1].read(expected.path)) === expected.content;
        const onRemote = remote?.content === expected.content;
        expect(
            inA || inB || onRemote,
            `data loss: content "${expected.content}" for ${expected.path} vanished — not on remote, not in A, not in B`,
        ).toBe(true);
    }
}

/** Full post-sync convergence gate used by the P0 suite: A + B + remote together. */
export async function expectTwoClientConvergence(context: ConvergenceContext): Promise<void> {
    await expectConverged(context);
    await expectMetadataConsistent(context);
    expectClean(...context.clients);
}

/** Convenience: builds the assertion context from a scenario + run prefix. */
export function convergenceContext(
    clients: [TwoClient, TwoClient],
    verifier: GitVerifier,
    branch: string,
    runPrefix: string,
): ConvergenceContext {
    return { clients, branch, verifier, runPrefix };
}