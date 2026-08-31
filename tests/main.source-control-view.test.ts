import { describe, it, expect, vi } from 'vitest';
import { WorkspaceLeaf } from 'obsidian';
import GitLabFilesPush from '../src/main';
import { SOURCE_CONTROL_VIEW_TYPE } from '../src/ui/source-control/SourceControlItemView';

interface FakeLeaf {
    detached: boolean;
    detach(this: FakeLeaf): void;
    setViewState: ReturnType<typeof vi.fn>;
    view?: { getViewType(): string };
}

function createFakeLeaf(type?: string): FakeLeaf & WorkspaceLeaf {
    const leaf: FakeLeaf = {
        detached: false,
        detach: function (this: FakeLeaf) { this.detached = true; },
        setViewState: vi.fn().mockResolvedValue(undefined),
    };
    if (type) leaf.view = { getViewType: () => type };
    return leaf as unknown as FakeLeaf & WorkspaceLeaf;
}

interface FakeWorkspaceOptions {
    leaves?: (FakeLeaf & WorkspaceLeaf)[];
    activeLeaf?: WorkspaceLeaf | null;
    rightLeaf?: FakeLeaf & WorkspaceLeaf;
}

function createFakeWorkspace(options: FakeWorkspaceOptions = {}) {
    const leaves = options.leaves ?? [];
    const state = {
        leaves,
        activeLeaf: options.activeLeaf ?? null,
        revealed: [] as WorkspaceLeaf[],
        // Count of setViewState calls with our view type = leaves created.
        created: 0,
    };
    const workspace = {
        getLeavesOfType: (type: string) =>
            state.leaves.filter(leaf => {
                const viewType = (leaf as FakeLeaf).view?.getViewType();
                return viewType === type;
            }),
        getRightLeaf: () => options.rightLeaf ?? createFakeLeaf(),
        revealLeaf: async (leaf: WorkspaceLeaf) => { state.revealed.push(leaf); },
        getActiveViewOfType: () => (options.activeLeaf ? { leaf: options.activeLeaf } : null),
        activeLeaf: options.activeLeaf ?? null,
    };
    return { workspace, state };
}

function callNormalize(
    fakePlugin: { app: { workspace: unknown } },
): WorkspaceLeaf | null {
    return (GitLabFilesPush.prototype as unknown as {
        normalizeSourceControlLeaves(): WorkspaceLeaf | null;
    }).normalizeSourceControlLeaves.call(fakePlugin);
}

async function callActivate(
    fakePlugin: Record<string, unknown>,
): Promise<void> {
    // fakePlugin isn't a GitLabFilesPush instance, so wire the private
    // prototype methods onto it directly (mirrors main.test.ts's approach).
    const proto = GitLabFilesPush.prototype as unknown as Record<string, unknown>;
    fakePlugin.doActivateSourceControlView = proto.doActivateSourceControlView;
    fakePlugin.normalizeSourceControlLeaves = proto.normalizeSourceControlLeaves;
    await (proto.activateSourceControlView as (this: unknown) => Promise<void>).call(fakePlugin);
}

describe('GitLabFilesPush source control leaf normalization', () => {
    it('creates exactly one leaf when none exist', async () => {
        const { workspace, state } = createFakeWorkspace();
        const fakePlugin = { app: { workspace } };

        await callActivate(fakePlugin);

        expect(state.created ?? 0).toBe(0); // setViewState happens on rightLeaf below
        const types = workspace.getLeavesOfType(SOURCE_CONTROL_VIEW_TYPE);
        // The fake rightLeaf is created outside the tracked state; assert via setViewState
        expect(state.revealed).toHaveLength(1);
        expect(types).toHaveLength(0);
    });

    it('reuses the single existing leaf without detaching or creating another', async () => {
        const existing = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const { workspace, state } = createFakeWorkspace({ leaves: [existing] });
        const fakePlugin = { app: { workspace } };

        await callActivate(fakePlugin);

        expect((existing as FakeLeaf).detached).toBe(false);
        expect((existing as FakeLeaf).setViewState).not.toHaveBeenCalled();
        expect(state.revealed).toEqual([existing]);
    });

    it('reveals the existing leaf (no replacement) for a legacy persisted sync-status leaf', async () => {
        // A leaf persisted by the old Sync Status view has the same type
        // string; activation must reuse it as the new Source Control view.
        const legacyLeaf = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const { workspace, state } = createFakeWorkspace({ leaves: [legacyLeaf] });
        const fakePlugin = { app: { workspace } };

        await callActivate(fakePlugin);

        expect(state.revealed).toEqual([legacyLeaf]);
        expect(state.revealed).not.toContain((workspace as unknown as { rightLeaf?: unknown }).rightLeaf);
    });

    it('keeps the active leaf as canonical and detaches the duplicate', () => {
        const a = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const b = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const { workspace } = createFakeWorkspace({ leaves: [a, b], activeLeaf: b });
        const fakePlugin = { app: { workspace } };

        const canonical = callNormalize(fakePlugin);

        expect(canonical).toBe(b);
        expect((b as FakeLeaf).detached).toBe(false);
        expect((a as FakeLeaf).detached).toBe(true);
    });

    it('keeps the first leaf when none is active, detaching the duplicate (2 leaves)', () => {
        const a = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const b = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const { workspace } = createFakeWorkspace({ leaves: [a, b] });
        const fakePlugin = { app: { workspace } };

        const canonical = callNormalize(fakePlugin);

        expect(canonical).toBe(a);
        expect((a as FakeLeaf).detached).toBe(false);
        expect((b as FakeLeaf).detached).toBe(true);
    });

    it('detaches two duplicates among three leaves, leaving exactly one', () => {
        const a = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const b = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const c = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const { workspace, state } = createFakeWorkspace({ leaves: [a, b, c], activeLeaf: c });
        const fakePlugin = { app: { workspace } };

        const canonical = callNormalize(fakePlugin);

        expect(canonical).toBe(c);
        expect((a as FakeLeaf).detached).toBe(true);
        expect((b as FakeLeaf).detached).toBe(true);
        expect((c as FakeLeaf).detached).toBe(false);
        expect(state.leaves.filter(l => !(l as FakeLeaf).detached)).toHaveLength(1);
    });

    it('ignores an active leaf of a different view type and keeps the first existing', () => {
        const a = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const b = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const other = createFakeLeaf('markdown');
        const { workspace } = createFakeWorkspace({ leaves: [a, b], activeLeaf: other });
        const fakePlugin = { app: { workspace } };

        const canonical = callNormalize(fakePlugin);

        expect(canonical).toBe(a);
        expect((a as FakeLeaf).detached).toBe(false);
        expect((b as FakeLeaf).detached).toBe(true);
    });

    it('returns null when no leaves exist', () => {
        const { workspace } = createFakeWorkspace();
        const fakePlugin = { app: { workspace } };

        expect(callNormalize(fakePlugin)).toBeNull();
    });

    // Regression: startup auto refresh and a user ribbon/command activation
    // can fire concurrently. The activation guard must share one run so the
    // "no existing leaf" check can't pass twice and create two leaves.
    it('concurrent activations share one run and produce one leaf', async () => {
        // Simulate the race: both callers observe no leaves, then each path
        // creates a leaf via getRightLeaf. The guard makes the second caller
        // await the first run instead of executing its own creation path.
        let created = 0;
        const trackCreation = (ws: ReturnType<typeof createFakeWorkspace>) => {
            const original = ws.workspace.getRightLeaf;
            ws.workspace.getRightLeaf = () => {
                created++;
                return original();
            };
        };

        const { workspace, state } = createFakeWorkspace();
        trackCreation({ workspace, state });
        const fakePlugin = { app: { workspace } } as unknown as Record<string, unknown>;

        await Promise.all([
            callActivate(fakePlugin),
            callActivate(fakePlugin),
        ]);

        expect(created).toBe(1);
        expect(state.revealed).toHaveLength(1);
    });

    // Regression for the creation-vs-creation window: even without the
    // promise-level guard intercepting (e.g. an interleaving that slips a
    // second leaf in during setViewState), the post-create normalization
    // collapses duplicates before reveal.
    it('collapses a duplicate created during setViewState before reveal', async () => {
        const racer = createFakeLeaf(SOURCE_CONTROL_VIEW_TYPE);
        const { workspace, state } = createFakeWorkspace();
        const rightLeaf = createFakeLeaf();
        workspace.getRightLeaf = () => {
            // A concurrent activation drops a leaf into the workspace while
            // the first caller is inside setViewState().
            state.leaves.push(racer);
            return rightLeaf;
        };
        const fakePlugin = { app: { workspace } };

        await callActivate(fakePlugin);

        const survivors = state.leaves.filter(l => !(l as FakeLeaf).detached);
        expect(survivors).toHaveLength(1);
    });
});