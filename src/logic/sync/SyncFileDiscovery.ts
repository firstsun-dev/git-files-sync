import { type App, TFile } from 'obsidian';
import { getEffectiveSymlinkHandling, isSyncMetadataAtPath, type GitLabFilesPushSettings } from '../../settings';
import type { GitignoreManager } from '../gitignore-manager';
import type { SyncStatusService } from '../sync-status-service';
import type { GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { readLocalSymlinkTarget } from '../../utils/symlink';

export interface SyncFileDiscoveryDependencies {
    app: App;
    settings: () => GitLabFilesPushSettings;
    gitService: () => GitServiceInterface;
    gitignoreManager: () => GitignoreManager;
    filterFilesByVaultFolder(files: TFile[]): TFile[];
    filterPathByVaultFolder(path: string): boolean;
    getNormalizedPath(path: string): string;
    getVaultPath(path: string): string;
}

export interface DiscoveredFiles {
    local: TFile[];
    remoteEntries: GitTreeEntry[];
    remoteHead?: string;
    remoteMap: Map<string, GitTreeEntry>;
    localMap: Set<string>;
    allMap: Map<string, TFile>;
    hiddenLocalPaths: Set<string>;
}

/**
 * Enumerates what exists locally and remotely (vault files, hidden files,
 * remote tree, vault-folder scope, .gitignore, symlink filtering) and
 * classifies remote-only-vs-local-deleted for paths with no local file.
 * Deliberately owns no status-resolution or rename-reconciliation logic.
 */
export class SyncFileDiscovery {
    constructor(
        private readonly dependencies: SyncFileDiscoveryDependencies,
        private readonly statuses: SyncStatusService,
    ) {}

    async discoverFiles(): Promise<DiscoveredFiles> {
        const { app } = this.dependencies;
        const settings = this.dependencies.settings();
        const gitService = this.dependencies.gitService();
        const gitignoreManager = this.dependencies.gitignoreManager();
        const allFiles = app.vault.getFiles();
        let local = this.dependencies.filterFilesByVaultFolder(allFiles);
        const remoteHead = await gitService.getBranchHead?.(settings.branch);
        const remoteEntries = await gitService.listFilesDetailed(remoteHead ?? settings.branch, false);

        await gitignoreManager.loadGitignores(remoteEntries);

        const remoteMap = new Map<string, GitTreeEntry>();
        const skipSymlinks = getEffectiveSymlinkHandling(settings) === 'skip';
        for (const entry of remoteEntries) {
            if (entry.symlink && skipSymlinks) continue;
            const normalized = this.getNormalizedRemotePath(entry.path);
            if (normalized === null) continue;

            const vaultPath = this.dependencies.getVaultPath(normalized);
            if (!gitignoreManager.isIgnored(normalized)) remoteMap.set(vaultPath, entry);
        }

        local = local.filter(file => !gitignoreManager.isIgnored(this.dependencies.getNormalizedPath(file.path)));
        const hiddenLocalPaths = await this.discoverHiddenLocalFiles();
        const filteredHiddenPaths = new Set(
            hiddenLocalPaths
                .filter(path => this.dependencies.filterPathByVaultFolder(path))
                .filter(path => !gitignoreManager.isIgnored(this.dependencies.getNormalizedPath(path))),
        );

        return {
            local,
            remoteEntries,
            remoteHead,
            remoteMap,
            localMap: new Set([...local.map(file => file.path), ...filteredHiddenPaths]),
            allMap: new Map(allFiles.map(file => [file.path, file])),
            hiddenLocalPaths: filteredHiddenPaths,
        };
    }

    getNormalizedRemotePath(remotePath: string): string | null {
        const rootPath = this.dependencies.settings().rootPath;
        if (!rootPath) return remotePath;
        const cleanRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
        if (remotePath.startsWith(cleanRoot)) return remotePath.substring(cleanRoot.length);
        return remotePath === rootPath ? '' : null;
    }

    async discoverHiddenLocalFiles(): Promise<string[]> {
        const result: string[] = [];
        await this.recursiveScan(this.dependencies.settings().vaultFolder || '', result);
        return result;
    }

    async recursiveScan(folderPath: string, result: string[]): Promise<void> {
        try {
            const listing = await this.dependencies.app.vault.adapter.list(folderPath);
            for (const file of listing.files) {
                if (!this.isHidden(file)) continue;
                if (readLocalSymlinkTarget(this.dependencies.app, file) !== null || await this.isLocalFile(file)) result.push(file);
            }
            for (const folder of listing.folders) {
                if (folder === '.git' || folder.endsWith('/.git')) continue;
                if (readLocalSymlinkTarget(this.dependencies.app, folder) !== null) {
                    if (this.isHidden(folder)) result.push(folder);
                    continue;
                }
                await this.recursiveScan(folder, result);
            }
        } catch {
            // Some Obsidian adapters do not support raw directory listing.
        }
    }

    async identifyExtraFiles(
        remoteMap: Map<string, GitTreeEntry>,
        localFilePaths: Set<string>,
        allLocalFileMap: Map<string, TFile>,
        pendingMoveOldPaths: Set<string> = new Set(),
    ): Promise<Array<TFile | string>> {
        const extra: Array<TFile | string> = [];
        for (const [vaultPath] of remoteMap) {
            if (localFilePaths.has(vaultPath) || pendingMoveOldPaths.has(vaultPath)) continue;

            let localFile = allLocalFileMap.get(vaultPath);
            if (!localFile) {
                const abstractFile = this.dependencies.app.vault.getAbstractFileByPath(vaultPath);
                if (abstractFile instanceof TFile) localFile = abstractFile;
            }

            if (localFile) extra.push(localFile);
            else if (await this.isLocalFile(vaultPath)) extra.push(vaultPath);
            else {
                // No local file at all. A tracked file that's since been
                // removed locally (sync metadata still present for the path,
                // and not a pending move source) is a *local deletion* — a
                // potential remote deletion — distinct from a never-tracked
                // remote-only file, which is simply available to download.
                this.statuses.set(vaultPath, {
                    path: vaultPath,
                    status: this.statuses.classify({
                        localExists: false,
                        remoteExists: true,
                        wasTracked: this.wasTrackedBeforeDelete(vaultPath),
                    }),
                });
            }
        }
        return extra;
    }

    initializeFileStatuses(localFiles: TFile[]): void {
        for (const file of localFiles) this.statuses.set(file.path, { file, path: file.path, status: 'checking' });
    }

    getCheckableFiles(
        local: TFile[],
        extra: Array<TFile | string>,
        hiddenLocalPaths: Set<string>,
    ): Array<TFile | string> {
        const extraPaths = new Set(extra.map(file => typeof file === 'string' ? file : file.path));
        const hiddenToAdd = [...hiddenLocalPaths].filter(path => !extraPaths.has(path));
        const gitignoreManager = this.dependencies.gitignoreManager();
        return [...local, ...extra, ...hiddenToAdd].filter(file => {
            const path = typeof file === 'string' ? file : file.path;
            return !gitignoreManager.isIgnored(this.dependencies.getNormalizedPath(path));
        });
    }

    /**
     * Whether `vaultPath` was previously tracked locally and has since been
     * removed (sync metadata present for the path, and not a pending move
     * source). Used to distinguish a `local-deleted` row from a
     * never-tracked `remote-only` download candidate.
     */
    private wasTrackedBeforeDelete(vaultPath: string): boolean {
        const metadata = this.dependencies.settings().syncMetadata;
        const pathMetadata = metadata ? metadata[vaultPath] : undefined;
        return isSyncMetadataAtPath(pathMetadata, vaultPath) && !pathMetadata.renamedFrom;
    }

    private isHidden(path: string): boolean {
        return path.split('/').some(part => part.startsWith('.'));
    }

    private async isLocalFile(vaultPath: string): Promise<boolean> {
        const stat = await this.dependencies.app.vault.adapter.stat(vaultPath);
        return stat?.type === 'file';
    }
}
