import type { GitServiceInterface } from '../../services/git-service-interface';
import { MAX_BATCH_PUSH_SIZE } from '../../services/git-service-base';

export interface RemoteDeleteTarget {
    path: string;
    repoPath: string;
}

export interface RemoteDeleteResult {
    deletedPaths: string[];
    errors: Array<{ path: string; message: string }>;
}

/** Owns provider mutation and atomic-chunk failure semantics for remote deletion. */
export class RemoteDeleteExecutor {
    constructor(
        private readonly gitService: GitServiceInterface,
        private readonly branch: string,
        private readonly batchSize = MAX_BATCH_PUSH_SIZE,
    ) {}

    async execute(
        targets: readonly RemoteDeleteTarget[],
        onProgress?: (current: number, target: RemoteDeleteTarget) => void,
    ): Promise<RemoteDeleteResult> {
        if (!this.gitService.deleteBatch) return this.executeSequentially(targets, onProgress);
        return this.executeInBatches(targets, onProgress);
    }

    private async executeInBatches(
        targets: readonly RemoteDeleteTarget[],
        onProgress?: (current: number, target: RemoteDeleteTarget) => void,
    ): Promise<RemoteDeleteResult> {
        const result: RemoteDeleteResult = { deletedPaths: [], errors: [] };
        targets.forEach((target, index) => onProgress?.(index + 1, target));

        for (let index = 0; index < targets.length; index += this.batchSize) {
            const chunk = targets.slice(index, index + this.batchSize);
            try {
                await this.gitService.deleteBatch!(
                    chunk.map(target => target.repoPath),
                    this.branch,
                    `Delete ${chunk.length} file(s) from Obsidian`,
                );
                result.deletedPaths.push(...chunk.map(target => target.path));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                result.errors.push(...chunk.map(target => ({ path: target.path, message })));
            }
        }
        return result;
    }

    private async executeSequentially(
        targets: readonly RemoteDeleteTarget[],
        onProgress?: (current: number, target: RemoteDeleteTarget) => void,
    ): Promise<RemoteDeleteResult> {
        const result: RemoteDeleteResult = { deletedPaths: [], errors: [] };
        let index = 0;
        for (const target of targets) {
            onProgress?.(index + 1, target);
            try {
                await this.gitService.deleteFile(target.repoPath, this.branch, `Delete ${target.repoPath}`);
                result.deletedPaths.push(target.path);
            } catch (error) {
                result.errors.push({
                    path: target.path,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            index += 1;
        }
        return result;
    }
}
