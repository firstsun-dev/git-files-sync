import type { App } from 'obsidian';
import type GitLabFilesPush from '../../main';
import type { SyncStatusService } from '../../logic/sync-status-service';
import { SyncStatusRefreshService } from '../../logic/sync/SyncStatusRefreshService';
import { ensureSyncWorkspaceRuntime } from '../../logic/sync/SyncWorkspace';
import type { SyncWorkspace } from '../../logic/sync/SyncWorkspace';
import { SyncStatusController } from './SyncStatusController';
import { SyncStatusNavigator } from './SyncStatusNavigator';
import { SyncStatusOperations } from './SyncStatusOperations';
import { SyncStatusRenderer } from './SyncStatusRenderer';
import type { SyncStatusViewState } from './SyncStatusViewState';

export interface SyncStatusComposition {
    controller: SyncStatusController;
    navigator: SyncStatusNavigator;
    operations: SyncStatusOperations;
    renderer: SyncStatusRenderer;
    statusRefresh: SyncStatusRefreshService;
    workspace: SyncWorkspace;
}

export interface SyncStatusCompositionCallbacks {
    render(): void;
    refresh(): Promise<void>;
    refreshStatuses(): Promise<void>;
}

/** Composition root for the sync-status UI and its domain-facing adapters. */
export function createSyncStatusComposition(
    app: App,
    plugin: GitLabFilesPush,
    state: SyncStatusViewState,
    statuses: SyncStatusService,
    callbacks: SyncStatusCompositionCallbacks,
    providedController?: SyncStatusController,
): SyncStatusComposition {
    const runtime = ensureSyncWorkspaceRuntime(app, plugin, statuses);
    const statusRefresh = runtime.refreshService;
    const navigator = new SyncStatusNavigator(app, runtime.workspace);
    const operations = new SyncStatusOperations(
        app,
        runtime.workspace,
        statuses,
        state,
        statusRefresh,
        navigator,
        () => callbacks.render(),
        () => callbacks.refresh(),
    );
    const controller = providedController ?? new SyncStatusController({
        refresh: () => callbacks.refreshStatuses(),
        push: paths => operations.runPaths(paths, 'push'),
        pull: paths => operations.runPaths(paths, 'pull'),
        delete: paths => operations.deletePaths(paths),
        openDiff: path => navigator.openDiff(path),
        pushOne: status => operations.runSingle(status, 'push'),
        pullOne: status => operations.runSingle(status, 'pull'),
        deleteLocal: status => operations.deleteLocal(status),
        loadDiff: path => navigator.loadDiff(path),
        openFile: (status, newLeaf) => navigator.openFile(status, newLeaf),
        canOpen: status => navigator.targetFor(status) !== null,
        revertMove: status => operations.revertMove(status),
        pushMoveGroup: members => operations.pushMoveGroup(members),
        revertMoveGroup: members => operations.revertMoveGroup(members),
        pushAllModified: () => operations.runBatch('modified', 'push'),
        pullAllModified: () => operations.runBatch('modified', 'pull'),
    });
    const renderer = new SyncStatusRenderer(() => runtime.workspace.getInfo(), state, statuses, controller, () => callbacks.render());
    return { controller, navigator, operations, renderer, statusRefresh, workspace: runtime.workspace };
}
