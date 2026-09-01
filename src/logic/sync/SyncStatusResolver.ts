import { type App, TFile } from 'obsidian';
import { getEffectiveSymlinkHandling, isSyncMetadataAtPath, type GitLabFilesPushSettings, type SymlinkHandling } from '../../settings';
import { type FileStatus, type SyncStatusService } from '../sync-status-service';
import type { GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { gitBlobSha } from '../../utils/git-blob-sha';
import { logger } from '../../utils/logger';
import { contentsEqual, isBinaryPath } from '../../utils/path';
import { readLocalSymlinkTarget } from '../../utils/symlink';
import type { SyncManager } from './SyncManager';

export interface SyncStatusResolverDependencies {
    app: App;
    settings: () => GitLabFilesPushSettings;
    gitService: () => GitServiceInterface;
    syncManager: () => SyncManager;
    getNormalizedPath(path: string): string;
}

export interface SyncStatusResolverProgress {
    current: number;
    total: number;
}

/**
 * Resolves a file's sync status: local-vs-remote diff, SHA/content
 * comparison, baseline direction, and `FileStatus` classification.
 * Deliberately owns no discovery or rename-reconciliation logic.
 */
export class SyncStatusResolver {
    private static readonly STATUS_CHECK_CONCURRENCY = 8;

    constructor(
        private readonly dependencies: SyncStatusResolverDependencies,
        private readonly statuses: SyncStatusService,
    ) {}

    async performStatusCheck(
        filesToCheck: Array<TFile | string>,
        remoteMap: Map<string, GitTreeEntry>,
        onProgress?: (progress: SyncStatusResolverProgress) => void,
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

        const workerCount = Math.min(SyncStatusResolver.STATUS_CHECK_CONCURRENCY, total);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
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
        const localSha = await gitBlobSha(localContent);
        const remoteSha = remoteEntry.sha;
        const status = this.statuses.classify({
            localExists: true,
            remoteExists: true,
            contentsEqual: localSha === remoteSha,
            ...(remoteSha !== undefined ? this.diffDirection(path, localSha, remoteSha) : {}),
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
        let status: FileStatus['status'];
        if (!remote.sha) {
            status = this.statuses.classify({ localExists: true, remoteExists: false });
        } else {
            const equal = contentsEqual(localContent, remote.content);
            status = this.statuses.classify({
                localExists: true,
                remoteExists: true,
                contentsEqual: equal,
                ...(equal ? {} : this.diffDirection(path, await gitBlobSha(localContent), remote.sha)),
            });
        }
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

    /**
     * Direction facts for a two-sided diff, relative to the last-synced
     * baseline: undefined for both when there is no baseline on record (the
     * two-sided diff then falls back to the direction-blind `modified`).
     */
    diffDirection(path: string, localSha: string, remoteSha: string): { localChanged?: boolean; remoteChanged?: boolean } {
        const baseSha = this.baseShaFor(path);
        if (baseSha === undefined) return {};
        return { localChanged: localSha !== baseSha, remoteChanged: remoteSha !== baseSha };
    }

    async readFileContent(fileOrPath: TFile | string, binary: boolean, isStringPath: boolean): Promise<string | ArrayBuffer> {
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

    /** The last-synced blob sha on record for `path`, or undefined if never tracked there. */
    private baseShaFor(path: string): string | undefined {
        const metadata = this.dependencies.settings().syncMetadata;
        const pathMetadata = metadata ? metadata[path] : undefined;
        return isSyncMetadataAtPath(pathMetadata, path) ? pathMetadata.lastSyncedSha : undefined;
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
