import type { SyncStatusService } from '../sync-status-service';
import { isBinaryPath } from '../../utils/path';
import type { FileDiff } from './types';

export type BlobReader = (sha: string, path: string) => Promise<{ content: string | ArrayBuffer }>;

/** Builds the only diff DTO exposed across the UI/domain boundary. */
export class SyncDiffService {
    constructor(
        private readonly statuses: SyncStatusService,
        private readonly readBlob: BlobReader,
    ) {}

    async getDiff(path: string): Promise<FileDiff> {
        const status = this.statuses.get(path);
        if (!status) throw new Error(`No sync status for ${path}`);

        if (status.remoteContent === undefined && status.remoteSha) {
            const blob = await this.readBlob(status.remoteSha, status.movedFrom ?? status.path);
            status.remoteContent = blob.content;
        }

        let kind: FileDiff['kind'] = isBinaryPath(status.path) ? 'binary' : 'text';
        if (status.isSymlink) kind = 'symlink';
        return {
            path: status.path,
            localContent: status.localContent,
            remoteContent: status.remoteContent,
            kind,
        };
    }
}
