import type { GitLabFilesPushSettings } from '../../settings';
import type { SyncStatusService } from '../sync-status-service';

/** Owns sync baseline persistence and rename metadata transitions. */
export class SyncMetadataStore {
    constructor(
        private readonly settings: GitLabFilesPushSettings,
        private readonly save: () => Promise<void>,
        private readonly status: SyncStatusService,
    ) {}

    async update(path: string, sha: string): Promise<void> {
        this.settings.syncMetadata[path] = {
            lastSyncedSha: sha,
            lastSyncedAt: Date.now(),
            lastKnownPath: path,
        };
        await this.save();
        this.status.markSynced(path, sha);
    }

    async clear(path: string): Promise<void> {
        if (!(path in this.settings.syncMetadata)) return;
        delete this.settings.syncMetadata[path];
        await this.save();
    }

    async trackRename(newPath: string, oldPath: string): Promise<void> {
        const metadata = this.settings.syncMetadata[oldPath];
        if (!metadata) return;

        delete this.settings.syncMetadata[oldPath];
        const remotePath = metadata.renamedFrom ?? oldPath;
        this.settings.syncMetadata[newPath] = {
            lastSyncedSha: metadata.lastSyncedSha,
            lastSyncedAt: metadata.lastSyncedAt,
            lastKnownPath: newPath,
            ...(newPath === remotePath ? {} : { renamedFrom: remotePath }),
        };
        await this.save();
    }
}
