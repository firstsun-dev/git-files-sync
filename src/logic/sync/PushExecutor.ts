import type { GitServiceInterface } from '../../services/git-service-interface';
import { gitBlobSha } from '../../utils/git-blob-sha';
import { MAX_BATCH_PUSH_SIZE } from '../../services/git-service-base';
import type { MoveQueueEntry, PushQueueEntry, PushResults } from './types';

export interface PushFileTarget {
    path: string;
    name: string;
}

export interface SymlinkPushResult {
    handled: boolean;
    synced: boolean;
    sha?: string;
}

/** Executes one provider-side push mutation; planning remains outside. */
export class PushExecutor {
    constructor(
        private readonly getGitService: () => GitServiceInterface,
        private readonly getBranch: () => string,
        private readonly toRepoPath: (path: string) => string,
        private readonly updateMetadata: (path: string, sha: string) => Promise<void>,
        private readonly getServiceName: () => string,
        private readonly notify: (message: string) => void = () => undefined,
        private readonly clearMovedSource: (path: string) => void = () => undefined,
    ) {}

    async push(
        file: PushFileTarget,
        content: string | ArrayBuffer,
        existingSha?: string,
        existingRevision?: string,
        silent = false,
    ): Promise<string> {
        const result = await this.getGitService().pushFile(
            this.toRepoPath(file.path),
            content,
            this.getBranch(),
            `Update ${file.name} from Obsidian`,
            existingSha,
            existingRevision,
        );
        const sha = result.sha ?? await gitBlobSha(content);
        await this.updateMetadata(file.path, sha);
        if (!silent) this.notify(`Pushed ${file.name} to ${this.getServiceName()}`);
        return sha;
    }

    async pushSymlink(
        file: PushFileTarget,
        target: string,
        mode: 'skip' | 'follow' | 'real',
        silent = false,
    ): Promise<SymlinkPushResult> {
        if (mode === 'skip') {
            if (!silent) this.notify(`Skipped symlink ${file.name}.`);
            return { handled: true, synced: false };
        }

        const service = this.getGitService();
        if (mode !== 'real' || !service.pushSymlink) return { handled: false, synced: false };
        const result = await service.pushSymlink(
            this.toRepoPath(file.path),
            target,
            this.getBranch(),
            `Update ${file.name} from Obsidian`,
        );
        if (result.sha) await this.updateMetadata(file.path, result.sha);
        if (!silent) this.notify(`Pushed symlink ${file.name} to ${this.getServiceName()}`);
        return { handled: true, synced: true, sha: result.sha };
    }

    async commitBatch(toPush: PushQueueEntry[], toMove: MoveQueueEntry[], results: PushResults): Promise<void> {
        const service = this.getGitService();
        if (toMove.length === 0) {
            if (!service.pushBatch) return this.pushSequentially(toPush, results);
            for (let index = 0; index < toPush.length; index += MAX_BATCH_PUSH_SIZE) {
                await this.commitPushChunk(toPush.slice(index, index + MAX_BATCH_PUSH_SIZE), results);
            }
            return;
        }

        if (!service.commitBatch) {
            await this.moveSequentially(toMove, results);
            await this.pushSequentially(toPush, results);
            return;
        }

        const combined: Array<{ kind: 'push'; entry: PushQueueEntry } | { kind: 'move'; entry: MoveQueueEntry }> = [
            ...toPush.map(entry => ({ kind: 'push' as const, entry })),
            ...toMove.map(entry => ({ kind: 'move' as const, entry })),
        ];
        for (let index = 0; index < combined.length; index += MAX_BATCH_PUSH_SIZE) {
            await this.commitCombinedChunk(combined.slice(index, index + MAX_BATCH_PUSH_SIZE), results);
        }
    }

    private async pushSequentially(entries: PushQueueEntry[], results: PushResults): Promise<void> {
        for (const entry of entries) {
            try {
                const sha = await this.push(entry, entry.content, entry.existingSha, entry.existingRevision, true);
                this.recordSuccess(entry.path, sha, results, !!entry.existingSha);
            } catch (error) {
                this.recordFailure(entry.path, error, results);
            }
        }
    }

    private async moveSequentially(entries: MoveQueueEntry[], results: PushResults): Promise<void> {
        for (const entry of entries) {
            try {
                const service = this.getGitService();
                const pushed = await service.pushFile(
                    entry.repoPath, entry.content, this.getBranch(), `Move ${entry.oldRepoPath} to ${entry.repoPath}`,
                );
                const sha = pushed.sha ?? await gitBlobSha(entry.content);
                await service.deleteFile(
                    entry.oldRepoPath, this.getBranch(), `Remove ${entry.oldRepoPath} (moved to ${entry.repoPath})`,
                );
                await this.updateMetadata(entry.path, sha);
                this.clearMovedSource(entry.oldPath);
                this.recordSuccess(entry.path, sha, results, true);
            } catch (error) {
                this.recordFailure(entry.path, error, results);
            }
        }
    }

    private async commitPushChunk(entries: PushQueueEntry[], results: PushResults): Promise<void> {
        try {
            const batchResults = await this.getGitService().pushBatch!(
                entries.map(entry => ({
                    path: entry.repoPath,
                    content: entry.content,
                    existedRemotely: !!entry.existingSha,
                    revision: entry.existingRevision,
                })),
                this.getBranch(),
                `Push ${entries.length} file(s) from Obsidian`,
            );
            const shaByPath = new Map(batchResults.map(result => [result.path, result.sha]));
            for (const entry of entries) {
                const sha = shaByPath.get(entry.repoPath) ?? await gitBlobSha(entry.content);
                await this.updateMetadata(entry.path, sha);
                this.recordSuccess(entry.path, sha, results, !!entry.existingSha);
            }
        } catch (error) {
            for (const entry of entries) this.recordFailure(entry.path, error, results);
        }
    }

    private async commitCombinedChunk(
        chunk: Array<{ kind: 'push'; entry: PushQueueEntry } | { kind: 'move'; entry: MoveQueueEntry }>,
        results: PushResults,
    ): Promise<void> {
        const pushes = chunk.filter((item): item is { kind: 'push'; entry: PushQueueEntry } => item.kind === 'push').map(item => item.entry);
        const moves = chunk.filter((item): item is { kind: 'move'; entry: MoveQueueEntry } => item.kind === 'move').map(item => item.entry);
        try {
            const batchResults = await this.getGitService().commitBatch!(
                pushes.map(entry => ({ path: entry.repoPath, content: entry.content, existedRemotely: !!entry.existingSha, revision: entry.existingRevision })),
                moves.map(entry => ({ oldPath: entry.oldRepoPath, newPath: entry.repoPath, content: entry.content, oldRevision: entry.oldRevision })),
                this.getBranch(),
                this.combinedCommitMessage(pushes.length, moves.length),
            );
            const shaByPath = new Map(batchResults.map(result => [result.path, result.sha]));
            for (const entry of pushes) await this.recordCommittedEntry(entry, shaByPath, results, !!entry.existingSha);
            for (const entry of moves) {
                await this.recordCommittedEntry(entry, shaByPath, results, true);
                this.clearMovedSource(entry.oldPath);
            }
        } catch (error) {
            for (const item of chunk) this.recordFailure(item.entry.path, error, results);
        }
    }

    private async recordCommittedEntry(
        entry: PushQueueEntry | MoveQueueEntry,
        shaByPath: ReadonlyMap<string, string | undefined>,
        results: PushResults,
        isUpdate: boolean,
    ): Promise<void> {
        const sha = shaByPath.get(entry.repoPath) ?? await gitBlobSha(entry.content);
        await this.updateMetadata(entry.path, sha);
        this.recordSuccess(entry.path, sha, results, isUpdate);
    }

    private combinedCommitMessage(pushCount: number, moveCount: number): string {
        if (moveCount === 0) return `Push ${pushCount} file(s) from Obsidian`;
        if (pushCount === 0) return `Move ${moveCount} file(s) from Obsidian`;
        return `Push ${pushCount} file(s) and move ${moveCount} file(s) from Obsidian`;
    }

    private recordSuccess(path: string, sha: string, results: PushResults, isUpdate: boolean): void {
        results.success += 1;
        if (isUpdate) results.updated += 1;
        else results.added += 1;
        results.syncedPaths.push({ path, sha });
    }

    private recordFailure(path: string, error: unknown, results: PushResults): void {
        results.failed += 1;
        results.errors.push({ file: path, error: error instanceof Error ? error.message : String(error) });
    }
}
