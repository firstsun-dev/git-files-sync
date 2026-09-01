import { isSyncMetadataAtPath, type GitLabFilesPushSettings } from '../../settings';
import type { SyncStatusService } from '../sync-status-service';
import type { GitTreeEntry } from '../../services/git-service-interface';
import { gitBlobSha } from '../../utils/git-blob-sha';
import type { SyncManager } from './SyncManager';

export interface RenameReconcilerDependencies {
    settings: () => GitLabFilesPushSettings;
    syncManager: () => SyncManager;
    /** Republishes a single path's status after it's been reconciled as a rename target. */
    refreshFileStatus(path: string, remoteEntry: GitTreeEntry | undefined): Promise<void>;
}

/**
 * Reconciles renames performed outside the plugin (e.g. via git directly):
 * matches an orphaned tracked path against an unsynced local file by blob
 * sha, and relocates the sync metadata. Deliberately owns no discovery or
 * status-resolution logic.
 */
export class RenameReconciler {
    constructor(
        private readonly dependencies: RenameReconcilerDependencies,
        private readonly statuses: SyncStatusService,
    ) {}

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
            await this.dependencies.refreshFileStatus(newPath, remoteMap.get(newPath));
        }
    }

    pendingMoveOldPaths(): Set<string> {
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
}
