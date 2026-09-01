import type { App, TFile } from 'obsidian';
import type { GitLabFilesPushSettings } from '../settings';
import type { GitServiceInterface } from '../services/git-service-interface';
import type { GitignoreManager } from '../logic/gitignore-manager';
import { SyncManager } from '../logic/sync-manager';
import { SyncStatusRefreshService } from '../logic/sync/SyncStatusRefreshService';
import { SyncDiffService } from '../logic/sync/SyncDiffService';
import { SyncManagerWorkspace, type SyncWorkspace } from '../logic/sync/SyncWorkspace';
import { ChangeRepository } from '../logic/source-control/ChangeRepository';
import { OperationState } from '../logic/source-control/OperationState';
import { RefreshState } from '../logic/source-control/RefreshState';
import { SyncSelectionStore } from '../logic/source-control/SyncSelectionStore';
import { SourceControlViewModel } from '../logic/source-control/SourceControlViewModel';
import { SourceControlActionService } from '../logic/source-control/SourceControlActionService';
import { SyncResultNotifier } from '../logic/source-control/SyncResultNotifier';
import { toSyncChanges } from '../logic/source-control/FileStatusAdapter';
import { ObsidianSyncInteraction } from '../ui/ObsidianSyncInteraction';

export interface SyncRuntimeDependencies {
    app: App;
    /** The concrete git service in effect at construction time (SyncManager tracks changes via `updateGitService`). */
    gitService: GitServiceInterface;
    getGitService: () => GitServiceInterface;
    /** The settings object in effect at construction time (mutated in place, not replaced). */
    settings: GitLabFilesPushSettings;
    getSettings: () => GitLabFilesPushSettings;
    saveSettings: () => Promise<void>;
    getGitignoreManager: () => GitignoreManager;
    isIgnored: (path: string) => boolean;
    filterFilesByVaultFolder(files: TFile[]): TFile[];
    filterPathByVaultFolder(path: string): boolean;
    getNormalizedPath(path: string): string;
    getVaultPath(path: string): string;
    notify: (message: string) => void;
}

export interface SyncRuntime {
    sync: SyncManager;
    syncStatusRefresh: SyncStatusRefreshService;
    syncDiffService: SyncDiffService;
    syncWorkspace: SyncWorkspace;
    changeRepository: ChangeRepository;
    syncSelectionStore: SyncSelectionStore;
    operationState: OperationState;
    refreshState: RefreshState;
    sourceControlViewModel: SourceControlViewModel;
    sourceControlActions: SourceControlActionService;
    /** Tears down cross-object wiring (the ChangeRepository subscription) that Obsidian does not manage. */
    dispose(): void;
}

/**
 * Wires the sync domain and Source Control application constructor graph
 * together: SyncManager, SyncStatusRefreshService, SyncDiffService,
 * SyncWorkspace, and the Source Control application layer built on top of
 * it. Deliberately knows nothing about Obsidian lifecycle events, commands,
 * views, or ribbons -- those stay owned by the plugin entry point.
 */
export function createSyncRuntime(deps: SyncRuntimeDependencies): SyncRuntime {
    const sync = new SyncManager(
        deps.app,
        deps.gitService,
        deps.settings,
        deps.saveSettings,
        deps.isIgnored,
        undefined,
        new ObsidianSyncInteraction(deps.app),
    );

    const syncStatusRefresh = new SyncStatusRefreshService({
        app: deps.app,
        settings: deps.getSettings,
        gitService: deps.getGitService,
        gitignoreManager: deps.getGitignoreManager,
        syncManager: () => sync,
        filterFilesByVaultFolder: files => deps.filterFilesByVaultFolder(files),
        filterPathByVaultFolder: path => deps.filterPathByVaultFolder(path),
        getNormalizedPath: path => deps.getNormalizedPath(path),
        getVaultPath: path => deps.getVaultPath(path),
    }, sync.status);

    // One diff data service shared by the sync workspace (diff pane), the
    // batch conflict modal's progressive +/- stat, and its "View Diff" -- the
    // modal never grows its own getBlob/cache path (see
    // SyncDiffService.getConflictDiff).
    const syncDiffService = new SyncDiffService(sync.status, (sha, path) => deps.getGitService().getBlob(sha, path));
    sync.setConflictDiffStatLoader(conflict => syncDiffService.getConflictStat(conflict));
    sync.setConflictDiffLoader(conflict => syncDiffService.getConflictDiff(conflict));

    const syncWorkspace = new SyncManagerWorkspace({
        manager: () => sync,
        gitService: deps.getGitService,
        settings: deps.getSettings,
        refreshService: syncStatusRefresh,
        diffService: syncDiffService,
        normalizePath: path => deps.getNormalizedPath(path),
        app: deps.app,
    });

    const changeRepository = new ChangeRepository();
    const syncSelectionStore = new SyncSelectionStore();
    const operationState = new OperationState();
    const refreshState = new RefreshState();
    const sourceControlViewModel = new SourceControlViewModel(
        changeRepository,
        syncSelectionStore,
        operationState,
        () => syncWorkspace.refresh(),
        refreshState,
    );
    const sourceControlActions = new SourceControlActionService(
        changeRepository,
        syncSelectionStore,
        operationState,
        syncWorkspace,
        new SyncResultNotifier(deps.notify),
    );

    // Selection-intent reconciliation is wired here, at the composition
    // root, rather than inside SourceControlViewModel: it is a write-side
    // lifecycle concern (stale selections/overrides get dropped whenever the
    // repository publishes an authoritative snapshot), not part of the
    // ViewModel's read-only projection.
    const unsubscribeSelectionReconciliation = changeRepository.subscribe(changes => syncSelectionStore.reconcile(changes));

    // Keeps ChangeRepository (and therefore the Source Control view) in sync
    // with the same SyncStatusService instance the sync domain already
    // publishes to -- no separate refresh/polling path. SyncSelectionStore
    // cleanup is handled by the reconciliation subscription above, which
    // ChangeRepository.replace() below triggers, so it isn't repeated here.
    const unsubscribeChangeRepository = sync.status.subscribe((statuses) => {
        const changes = toSyncChanges([...statuses.values()]);
        changeRepository.replace(changes);
    });

    return {
        sync,
        syncStatusRefresh,
        syncDiffService,
        syncWorkspace,
        changeRepository,
        syncSelectionStore,
        operationState,
        refreshState,
        sourceControlViewModel,
        sourceControlActions,
        dispose: () => {
            unsubscribeChangeRepository();
            unsubscribeSelectionReconciliation();
        },
    };
}
