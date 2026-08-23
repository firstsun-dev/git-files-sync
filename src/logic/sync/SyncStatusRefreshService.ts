import { type App, TFile } from 'obsidian';
import { getEffectiveSymlinkHandling, isSyncMetadataAtPath, type GitLabFilesPushSettings, type SymlinkHandling } from '../../settings';
import type { GitignoreManager } from '../gitignore-manager';
import { type FileStatus, SyncStatusService } from '../sync-status-service';
import type { GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { gitBlobSha } from '../../utils/git-blob-sha';
import { logger } from '../../utils/logger';
import { contentsEqual, isBinaryPath } from '../../utils/path';
import { readLocalSymlinkTarget } from '../../utils/symlink';
import type { SyncManager } from './SyncManager';

export interface SyncStatusRefreshDependencies {
    app: App;
    settings: () => GitLabFilesPushSettings;
    gitService: () => GitServiceInterface;
    gitignoreManager: () => GitignoreManager;
    syncManager: () => SyncManager;
    filterFilesByVaultFolder(files: TFile[]): TFile[];
    filterPathByVaultFolder(path: string): boolean;
    getNormalizedPath(path: string): string;
    getVaultPath(path: string): string;
}

export interface SyncStatusRefreshProgress {
    current: number;
    total: number;
}

export interface SyncStatusRefreshResult {
    localCount: number;
    remoteCount: number;
    remoteHead?: string;
    remoteEntries: GitTreeEntry[];
}

interface DiscoveredFiles {
    local: TFile[];
    remoteEntries: GitTreeEntry[];
    remoteHead?: string;
    remoteMap: Map<string, GitTreeEntry>;
    localMap: Set<string>;
    allMap: Map<string, TFile>;
    hiddenLocalPaths: Set<string>;
}

/**
 * Scans local/remote state and projects it into the shared status store.
 * It deliberately exposes no rendering or notification concepts.
 */
export class SyncStatusRefreshService {
    private static readonly STATUS_CHECK_CONCURRENCY = 8;

    constructor(
        private readonly dependencies: SyncStatusRefreshDependencies,
        private readonly statuses: SyncStatusService,
    ) {}

    async refresh(onProgress?: (progress: SyncStatusRefreshProgress) => void): Promise<SyncStatusRefreshResult> {
        this.statuses.clear();
        const files = await this.discoverFiles();
        this.initializeFileStatuses(files.local);
        for (const hiddenPath of files.hiddenLocalPaths) {
            this.statuses.set(hiddenPath, { path: hiddenPath, status: 'checking' });
        }
        const extra = await this.identifyExtraFiles(
            files.remoteMap,
            files.localMap,
            files.allMap,
            this.pendingMoveOldPaths(),
        );
        this.addExtraToStatuses(extra);

        const filesToCheck = this.getCheckableFiles(files.local, extra, files.hiddenLocalPaths);
        await this.performStatusCheck(filesToCheck, files.remoteMap, onProgress);
        await this.reconcileOutOfBandMoves(files.remoteMap);

        return {
            localCount: files.local.length + files.hiddenLocalPaths.size,
            remoteCount: files.remoteMap.size,
            remoteHead: files.remoteHead,
            remoteEntries: files.remoteEntries,
        };
    }

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

    async reconcileOutOfBandMoves(remoteMap: Map<string, GitTreeEntry>): Promise<void> {
        const orphansBySha = this.orphanedMoveSourcesBySha(remoteMap);
        if (orphansBySha.size === 0) return;
        const candidatesBySha = await this.unsyncedMoveDestinationsBySha(remoteMap, orphansBySha);

        for (const [sha, orphanPaths] of orphansBySha) {
            if (orphanPaths.length !== 1) continue;
            const newPaths = candidatesBySha.get(sha);
            if (!newPaths || newPaths.length !== 1) continue;
            const oldPath = orphanPaths[0] as string;
            const newPath = newPaths[0] as string;
            await this.dependencies.syncManager().trackRename(newPath, oldPath);
            this.statuses.delete(oldPath);
            await this.refreshFileStatus(newPath, remoteMap.get(newPath));
        }
    }

    async performStatusCheck(
        filesToCheck: Array<TFile | string>,
        remoteMap: Map<string, GitTreeEntry>,
        onProgress?: (progress: SyncStatusRefreshProgress) => void,
    ): Promise<void> {
        const total = filesToCheck.length;
        let current = 0;
        let next = 0;
        onProgress?.({ current, total });

        const worker = async (): Promise<void> => {
            while (next < total) {
                const file = filesToCheck[next++];
                if (file) {
                    const path = typeof file === 'string' ? file : file.path;
                    await this.refreshFileStatus(file, remoteMap.get(path), remoteMap);
                }
                current += 1;
                onProgress?.({ current, total });
            }
        };

        const workerCount = Math.min(SyncStatusRefreshService.STATUS_CHECK_CONCURRENCY, total);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    /**
     * Handles an out-of-band local create so a brand-new file appears in the
     * Source Control view immediately rather than waiting for the next full
     * refresh. The file is classified `unsynced` (local-only) optimistically:
     * a full refresh later reconciles it against the remote tree, promoting
     * it to `synced`/`modified` if a matching remote entry exists.
     *
     * No-op when the path is already tracked (a `modify`/`rename` event will
     * have handled it) or falls outside the configured vault folder. Returns
     * whether the status map changed, so a caller can skip a republish.
     */
    handleFileCreated(file: TFile): boolean {
        if (this.statuses.has(file.path) || !this.dependencies.filterPathByVaultFolder(file.path)) return false;
        this.statuses.set(file.path, {
            file,
            path: file.path,
            status: this.statuses.classify({ localExists: true, remoteExists: false }),
        });
        return true;
    }

    async handleFileModified(file: TFile): Promise<boolean> {
        const existing = this.statuses.get(file.path);
        if (!existing || !['synced', 'modified', 'unsynced', 'moved'].includes(existing.status)) return false;
        const localContent = await this.readFileContent(file, isBinaryPath(file.path), false);
        let status: FileStatus['status'] = existing.status;
        if (existing.status !== 'moved') {
            status = existing.remoteSha === undefined
                ? this.statuses.classify({ localExists: true, remoteExists: false })
                : this.statuses.classify({
                    localExists: true,
                    remoteExists: true,
                    contentsEqual: await gitBlobSha(localContent) === existing.remoteSha,
                });
        }
        this.statuses.set(file.path, { ...existing, status, localContent });
        return true;
    }

    handleFileRenamed(file: TFile, oldPath: string): boolean {
        const existing = this.statuses.get(oldPath);
        if (!existing || existing.status === 'checking') return false;
        this.statuses.delete(oldPath);
        if (!this.dependencies.filterPathByVaultFolder(file.path)) return true;

        const renamedFrom = this.dependencies.settings().syncMetadata?.[file.path]?.renamedFrom;
        if (renamedFrom !== undefined) {
            this.statuses.set(file.path, {
                file,
                path: file.path,
                status: this.statuses.classify({ movedFrom: renamedFrom }),
                movedFrom: renamedFrom,
                remoteSha: existing.remoteSha,
                localContent: existing.localContent,
                isSymlink: existing.isSymlink,
            });
        } else {
            this.statuses.set(file.path, { ...existing, file, path: file.path });
        }
        return true;
    }

    /**
     * Handles an out-of-band local delete of a previously known file so the
     * Source Control view reflects it immediately rather than waiting for the
     * next full refresh.
     *
     * - A *tracked* file removed locally (`synced`/`modified`) is marked
     *   `local-deleted`: the remote still holds it, so this is a potential
     *   remote deletion, distinct from a never-tracked `remote-only` file.
     * - A *local-only* (`unsynced`) file simply drops out of the status map —
     *   nothing on the remote to delete or restore, so there's no change to
     *   surface.
     * - A tracked *move* (`moved`) abandons its move: the row is dropped and a
     *   later refresh reconciles the old remote path (still on the remote,
     *   metadata relocated by `trackRename`) as `remote-only`/`local-deleted`.
     * - A `remote-only`/`local-deleted`/`checking` row is left untouched
     *   (nothing local existed to delete, or it's still resolving).
     *
     * Returns whether the status map changed, so a caller can skip a
     * republish when nothing moved.
     */
    handleFileDeleted(path: string): boolean {
        const existing = this.statuses.get(path);
        if (!existing || existing.status === 'checking' || existing.status === 'remote-only' || existing.status === 'local-deleted') return false;
        if (existing.status === 'moved') {
            this.statuses.delete(path);
            return true;
        }
        if (existing.status === 'unsynced') {
            this.statuses.delete(path);
            return true;
        }
        // synced / modified: tracked, remote still holds this path -> local-deleted.
        this.statuses.set(path, { ...existing, status: 'local-deleted', localContent: undefined });
        return true;
    }

    async refreshFileStatus(
        fileOrPath: TFile | string,
        remoteEntry: GitTreeEntry | undefined,
        remoteMap?: Map<string, GitTreeEntry>,
    ): Promise<void> {
        try {
            const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
            const renamedFrom = this.dependencies.settings().syncMetadata?.[path]?.renamedFrom;
            if (renamedFrom !== undefined) {
                await this.refreshMovedFileStatus(fileOrPath, renamedFrom, remoteMap?.get(renamedFrom));
            } else if (remoteEntry === undefined) {
                await this.refreshLocalOnlyStatus(fileOrPath);
            } else if (remoteEntry.sha !== undefined) {
                await this.refreshFileStatusBySha(fileOrPath, remoteEntry);
            } else {
                await this.refreshFileStatusByContent(fileOrPath);
            }
        } catch (error) {
            const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
            logger.warn(`Failed to determine sync status for ${path}`, error);
            this.statuses.set(path, {
                file: typeof fileOrPath === 'string' ? undefined : fileOrPath,
                path,
                status: this.statuses.classify({ localExists: true, remoteExists: false }),
            });
        }
    }

    async refreshFileStatusBySha(fileOrPath: TFile | string, remoteEntry: GitTreeEntry): Promise<void> {
        const isStringPath = typeof fileOrPath === 'string';
        const path = isStringPath ? fileOrPath : fileOrPath.path;
        const file = isStringPath ? undefined : fileOrPath;
        const binary = isBinaryPath(path);
        const symlinkMode = getEffectiveSymlinkHandling(this.dependencies.settings());
        const localContent = await this.readLocalContentForSha(fileOrPath, isStringPath, binary, remoteEntry.symlink, symlinkMode);
        const status = this.statuses.classify({
            localExists: true,
            remoteExists: true,
            contentsEqual: await gitBlobSha(localContent) === remoteEntry.sha,
        });
        if (status === 'synced' && remoteEntry.sha) {
            await this.dependencies.syncManager().updateMetadata(path, remoteEntry.sha);
        }
        this.statuses.set(path, {
            file,
            path,
            status,
            localContent,
            remoteSha: remoteEntry.sha,
            isSymlink: remoteEntry.symlink,
        });
    }

    async refreshFileStatusByContent(fileOrPath: TFile | string): Promise<void> {
        const isStringPath = typeof fileOrPath === 'string';
        const path = isStringPath ? fileOrPath : fileOrPath.path;
        const file = isStringPath ? undefined : fileOrPath;
        const localContent = await this.readFileContent(fileOrPath, isBinaryPath(path), isStringPath);
        const remote = await this.dependencies.gitService().getFile(
            this.dependencies.getNormalizedPath(path),
            this.dependencies.settings().branch,
        );
        const status = remote.sha
            ? this.statuses.classify({
                localExists: true,
                remoteExists: true,
                contentsEqual: contentsEqual(localContent, remote.content),
            })
            : this.statuses.classify({ localExists: true, remoteExists: false });
        if (status === 'synced' && remote.sha) {
            await this.dependencies.syncManager().updateMetadata(path, remote.sha);
        }
        this.statuses.set(path, {
            file,
            path,
            status,
            localContent,
            remoteContent: remote.content,
            remoteSha: remote.sha,
        });
    }

    private isHidden(path: string): boolean {
        return path.split('/').some(part => part.startsWith('.'));
    }

    private async isLocalFile(vaultPath: string): Promise<boolean> {
        const stat = await this.dependencies.app.vault.adapter.stat(vaultPath);
        return stat?.type === 'file';
    }

    private initializeFileStatuses(localFiles: TFile[]): void {
        for (const file of localFiles) this.statuses.set(file.path, { file, path: file.path, status: 'checking' });
    }

    private pendingMoveOldPaths(): Set<string> {
        const paths = new Set<string>();
        for (const metadata of Object.values(this.dependencies.settings().syncMetadata ?? {})) {
            if (metadata.renamedFrom) paths.add(metadata.renamedFrom);
        }
        return paths;
    }

    private orphanedMoveSourcesBySha(remoteMap: Map<string, GitTreeEntry>): Map<string, string[]> {
        const metadata = this.dependencies.settings().syncMetadata ?? {};
        const orphansBySha = new Map<string, string[]>();
        for (const [path, status] of this.statuses) {
            // A tracked-then-deleted file is now classified `local-deleted`
            // (not `remote-only`), so both qualify as an orphaned move
            // source: the remote entry still exists, sync metadata is
            // present for the path, and it isn't itself a pending move.
            if (status.status !== 'remote-only' && status.status !== 'local-deleted') continue;
            const pathMetadata = metadata[path];
            if (!isSyncMetadataAtPath(pathMetadata, path) || pathMetadata.renamedFrom) continue;
            const entry = remoteMap.get(path);
            if (!entry || entry.symlink || !entry.sha) continue;
            const paths = orphansBySha.get(entry.sha) ?? [];
            paths.push(path);
            orphansBySha.set(entry.sha, paths);
        }
        return orphansBySha;
    }

    private async unsyncedMoveDestinationsBySha(
        remoteMap: Map<string, GitTreeEntry>,
        orphansBySha: Map<string, string[]>,
    ): Promise<Map<string, string[]>> {
        const candidatesBySha = new Map<string, string[]>();
        for (const [path, status] of this.statuses) {
            if (status.status !== 'unsynced' || status.localContent === undefined || remoteMap.has(path)) continue;
            const sha = await gitBlobSha(status.localContent);
            if (!orphansBySha.has(sha)) continue;
            const paths = candidatesBySha.get(sha) ?? [];
            paths.push(path);
            candidatesBySha.set(sha, paths);
        }
        return candidatesBySha;
    }

    private addExtraToStatuses(extra: Array<TFile | string>): void {
        for (const item of extra) {
            const path = typeof item === 'string' ? item : item.path;
            this.statuses.set(path, {
                file: typeof item === 'string' ? undefined : item,
                path,
                status: 'checking',
            });
        }
    }

    private getCheckableFiles(
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

    private async refreshMovedFileStatus(fileOrPath: TFile | string, movedFrom: string, sourceEntry?: GitTreeEntry): Promise<void> {
        const isStringPath = typeof fileOrPath === 'string';
        const path = isStringPath ? fileOrPath : fileOrPath.path;
        const localContent = await this.readFileContent(fileOrPath, isBinaryPath(path), isStringPath);
        this.statuses.set(path, {
            file: isStringPath ? undefined : fileOrPath,
            path,
            status: this.statuses.classify({ movedFrom }),
            movedFrom,
            localContent,
            remoteSha: sourceEntry?.sha,
            isSymlink: sourceEntry?.symlink,
        });
    }

    private async refreshLocalOnlyStatus(fileOrPath: TFile | string): Promise<void> {
        const isStringPath = typeof fileOrPath === 'string';
        const path = isStringPath ? fileOrPath : fileOrPath.path;
        const localContent = await this.readFileContent(fileOrPath, isBinaryPath(path), isStringPath);
        this.statuses.set(path, {
            file: isStringPath ? undefined : fileOrPath,
            path,
            status: this.statuses.classify({ localExists: true, remoteExists: false }),
            localContent,
        });
    }

    private async readLocalContentForSha(
        fileOrPath: TFile | string,
        isStringPath: boolean,
        binary: boolean,
        remoteIsSymlink: boolean,
        symlinkMode: SymlinkHandling,
    ): Promise<string | ArrayBuffer> {
        if (remoteIsSymlink && symlinkMode === 'real') {
            const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
            const target = readLocalSymlinkTarget(this.dependencies.app, path);
            if (target !== null) return target;
        }
        return this.readFileContent(fileOrPath, binary, isStringPath);
    }

    private async readFileContent(fileOrPath: TFile | string, binary: boolean, isStringPath: boolean): Promise<string | ArrayBuffer> {
        if (isStringPath) return this.readStringPathContent(fileOrPath as string, binary);
        if (!(fileOrPath instanceof TFile)) throw new Error('Expected TFile when isStringPath is false');
        try {
            return binary
                ? await this.dependencies.app.vault.readBinary(fileOrPath)
                : await this.dependencies.app.vault.read(fileOrPath);
        } catch (error) {
            logger.warn(`vault.read failed for ${fileOrPath.path}; falling back to adapter`, error);
            return binary
                ? await this.dependencies.app.vault.adapter.readBinary(fileOrPath.path)
                : await this.dependencies.app.vault.adapter.read(fileOrPath.path);
        }
    }

    private async readStringPathContent(path: string, binary: boolean): Promise<string | ArrayBuffer> {
        try {
            return binary
                ? await this.dependencies.app.vault.adapter.readBinary(path)
                : await this.dependencies.app.vault.adapter.read(path);
        } catch (error) {
            const target = readLocalSymlinkTarget(this.dependencies.app, path);
            if (target !== null) return target;
            throw error;
        }
    }
}
