import type { GitServiceInterface } from '../../services/git-service-interface';
import type { BatchPushConflict, PushResults } from './types';
import type { PullExecutor } from './PullExecutor';

/** Applies already-decided conflict resolutions against the reviewed remote snapshot. */
export class ConflictResolver {
    constructor(
        private readonly getGitService: () => GitServiceInterface,
        private readonly getBranch: () => string,
        private readonly pullExecutor: PullExecutor,
    ) {}

    async findStale(conflicts: readonly BatchPushConflict[]): Promise<BatchPushConflict[]> {
        const stale: BatchPushConflict[] = [];
        for (const conflict of conflicts) {
            const current = await this.getGitService().getFile(conflict.repoPath, this.getBranch());
            if (current.sha !== conflict.remoteSha) stale.push(conflict);
        }
        return stale;
    }

    async applyRemote(conflicts: readonly BatchPushConflict[], results: PushResults): Promise<void> {
        for (const conflict of conflicts) {
            try {
                const blob = await this.getGitService().getBlob(conflict.remoteSha, conflict.repoPath);
                const symlinkTarget = blob.isSymlink ? blob.symlinkTarget ?? '' : undefined;
                await this.pullExecutor.pull(
                    { path: conflict.path, name: conflict.name },
                    blob.content,
                    blob.sha,
                    true,
                    symlinkTarget,
                );
                results.resolvedConflicts += 1;
                results.syncedPaths.push({ path: conflict.path, sha: blob.sha });
            } catch (error) {
                results.failed += 1;
                results.errors.push({
                    file: conflict.path,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
}
