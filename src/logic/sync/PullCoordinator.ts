import { TFile } from 'obsidian';
import type { GitLabFilesPushSettings } from '../../settings';
import type { GitFile, GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { gitBlobSha } from '../../utils/git-blob-sha';
import { logger } from '../../utils/logger';
import { contentsEqual, isBinaryPath } from '../../utils/path';
import type { PullExecutor } from './PullExecutor';
import type { SyncScanner } from './SyncScanner';
import { SyncPlanner } from './SyncPlanner';
import type { SyncPlan, SyncPlanEntry, SyncResult } from './types';
import { isSyncPlanEmpty } from './types';

type BatchOutcome = 'done' | 'unchanged' | 'conflict';
type PlanKind = 'addition' | 'modification' | 'unchanged' | 'conflict' | 'skip';

export interface PullCoordinatorDependencies {
    gitService(): GitServiceInterface;
    settings: GitLabFilesPushSettings;
    scanner: SyncScanner;
    executor: PullExecutor;
    confirmPlan(plan: SyncPlan): Promise<boolean>;
    updateMetadata(path: string, sha: string): Promise<void>;
    migrateBaseline(path: string, repoPath: string, entry: GitTreeEntry | undefined): Promise<void>;
    saveSettings(): Promise<void>;
    notify(message: string, duration?: number): void;
    serviceName(): string;
}

/** Plans and executes batch pulls without exposing orchestration in the facade. */
export class PullCoordinator {
    private readonly planner = new SyncPlanner();

    constructor(private readonly dependencies: PullCoordinatorDependencies) {}

    async pullAllFiles(
        files: Array<TFile | string>,
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[],
    ): Promise<SyncResult> {
        const tree = await this.resolveTree(remoteTree);
        const plan = await this.planPullBatch(files, tree);
        if (!isSyncPlanEmpty(plan) && !await this.dependencies.confirmPlan(plan)) {
            return { success: 0, failed: 0, conflicts: 0, errors: [] };
        }
        return this.processBatch(files, onProgress, tree);
    }

    async planPullBatch(files: Array<TFile | string>, remoteTree?: GitTreeEntry[]): Promise<SyncPlan> {
        const tree = remoteTree ? new Map(remoteTree.map(entry => [entry.path, entry])) : undefined;
        const plan: SyncPlan = { additions: [], modifications: [], deletions: [], moves: [] };
        for (const file of files) {
            if (!file) continue;
            const { path, name, isString } = this.dependencies.scanner.fileInfo(file);
            try {
                this.addPlanEntry(plan, await this.classifyForPlan(file, path, isString, tree), path, name);
            } catch (error) {
                logger.warn(`Skipping ${path} from pull plan preview`, error);
            }
        }
        return plan;
    }

    private async resolveTree(remoteTree?: GitTreeEntry[]): Promise<GitTreeEntry[] | undefined> {
        if (remoteTree) return remoteTree;
        try {
            return await this.dependencies.gitService().listFilesDetailed(this.dependencies.settings.branch, false);
        } catch (error) {
            logger.warn('Failed to fetch remote tree for pull; falling back to per-file fetches', error);
            return undefined;
        }
    }

    private async processBatch(
        files: Array<TFile | string>,
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[],
    ): Promise<SyncResult> {
        const results: SyncResult = { success: 0, failed: 0, conflicts: 0, errors: [] };
        const tree = remoteTree ? new Map(remoteTree.map(entry => [entry.path, entry])) : undefined;
        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            if (!file) continue;
            const { path, name, isString } = this.dependencies.scanner.fileInfo(file);
            onProgress?.(index + 1, files.length, name);
            try {
                const outcome = await this.processFile(file, path, name, isString, tree);
                if (outcome === 'done') results.success += 1;
                else if (outcome === 'conflict') results.conflicts += 1;
            } catch (error) {
                logger.error(`Failed to pull ${path}:`, error);
                results.failed += 1;
                results.errors.push({ file: path, error: this.errorMessage(error) });
            }
        }
        await this.dependencies.saveSettings();
        this.notifyResult(results);
        return results;
    }

    private async classifyForPlan(
        file: TFile | string,
        path: string,
        isString: boolean,
        tree?: Map<string, GitTreeEntry>,
    ): Promise<PlanKind> {
        const repoPath = this.dependencies.scanner.toRepoPath(path);
        const entry = tree?.get(this.dependencies.scanner.toTreePath(repoPath));
        if (tree && !entry) return 'skip';
        if (!await this.fileExists(file)) return 'addition';
        if (!entry?.sha || entry.symlink) return 'modification';
        const localSha = await gitBlobSha(await this.dependencies.scanner.readContent(file));
        if (localSha === entry.sha) return 'unchanged';
        await this.dependencies.migrateBaseline(path, repoPath, entry);
        const baseline = this.dependencies.settings.syncMetadata[path];
        return baseline && entry.sha !== baseline.lastSyncedSha ? 'conflict' : 'modification';
    }

    private async processFile(
        file: TFile | string,
        path: string,
        name: string,
        isString: boolean,
        tree?: Map<string, GitTreeEntry>,
    ): Promise<BatchOutcome> {
        const repoPath = this.dependencies.scanner.toRepoPath(path);
        if (tree) {
            const entry = tree.get(this.dependencies.scanner.toTreePath(repoPath));
            if (!entry) throw new Error('File not found in remote');
            const outcome = await this.classifyFromTree(file, path, isString, entry);
            if (outcome) return outcome;
        }
        const remote = await this.dependencies.gitService().getFile(repoPath, this.dependencies.settings.branch);
        if (!remote.sha) throw new Error('File not found in remote');
        if (await this.fileExists(file)) {
            const localContent = await this.dependencies.scanner.readContent(file);
            if (contentsEqual(localContent, remote.content)) {
                await this.dependencies.updateMetadata(path, remote.sha);
                return 'unchanged';
            }
            const baseline = this.dependencies.settings.syncMetadata[path];
            if (baseline && !this.sameBaseline(baseline.lastSyncedSha, remote)) return 'conflict';
        }
        const target = typeof file === 'string' ? { path, name } : file;
        await this.dependencies.executor.pull(target, remote.content, remote.sha, true, this.symlinkTarget(remote));
        return 'done';
    }

    private async classifyFromTree(
        file: TFile | string,
        path: string,
        isString: boolean,
        entry: GitTreeEntry,
    ): Promise<BatchOutcome | null> {
        if (entry.symlink || !entry.sha || !await this.fileExists(file)) return null;
        const localSha = await gitBlobSha(await this.dependencies.scanner.readContent(file));
        const baseline = this.dependencies.settings.syncMetadata[path];
        const classification = this.planner.classify({
            local: { path, exists: true, blobSha: localSha, kind: isBinaryPath(path) ? 'binary' : 'text' },
            remote: {
                path,
                repoPath: this.dependencies.scanner.toRepoPath(path),
                exists: true,
                blobSha: entry.sha,
                kind: 'text',
            },
            base: { blobSha: baseline?.lastSyncedSha },
        });
        if (classification === 'synced') {
            await this.dependencies.updateMetadata(path, entry.sha);
            return 'unchanged';
        }
        await this.dependencies.migrateBaseline(path, this.dependencies.scanner.toRepoPath(path), entry);
        const migratedBaseline = this.dependencies.settings.syncMetadata[path];
        return migratedBaseline && entry.sha !== migratedBaseline.lastSyncedSha ? 'conflict' : null;
    }

    private fileExists(file: TFile | string): Promise<boolean> | boolean {
        return typeof file === 'string'
            ? this.dependencies.scanner.pathExists(file)
            : this.dependencies.scanner.indexedFileExists(file.path);
    }

    private addPlanEntry(plan: SyncPlan, kind: PlanKind, path: string, name: string): void {
        const entry: SyncPlanEntry = { path, name };
        if (kind === 'addition') plan.additions.push(entry);
        else if (kind === 'modification') plan.modifications.push(entry);
    }

    private symlinkTarget(remote: GitFile): string | undefined {
        return remote.isSymlink ? remote.symlinkTarget ?? '' : undefined;
    }

    private sameBaseline(sha: string, remote: GitFile): boolean {
        return sha === remote.sha || sha === remote.revision;
    }

    private notifyResult(result: SyncResult): void {
        if (result.success > 0) this.dependencies.notify(`Pulled ${result.success} file(s) to ${this.dependencies.serviceName()}`);
        if (result.conflicts > 0) {
            this.dependencies.notify(`Skipped ${result.conflicts} file(s) with conflicting changes on both sides. Push or pull each one individually to resolve.`, 8000);
        }
        if (result.failed > 0) this.dependencies.notify(`Failed to pull ${result.failed} file(s). Check console for details.`);
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
