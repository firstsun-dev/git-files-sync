import { TFile } from 'obsidian';
import type { GitLabFilesPushSettings } from '../../settings';
import type { GitFile, GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { gitBlobSha } from '../../utils/git-blob-sha';
import { logger } from '../../utils/logger';
import { contentsEqual, isBinaryPath } from '../../utils/path';
import { t } from '../../i18n';
import type { PullExecutor } from './PullExecutor';
import type { SyncScanner } from './SyncScanner';
import { SyncPlanner } from './SyncPlanner';
import type { PlannedFileAction, SyncPlan, SyncPlanEntry, SyncResult } from './types';
import { isSyncPlanEmpty } from './types';

type BatchOutcome = 'added' | 'updated' | 'unchanged' | 'conflict';
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
            return { success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, errors: [] };
        }
        return this.processBatch(files, onProgress, tree);
    }

    /**
     * Applies an already-planned/confirmed pull batch without showing its own
     * confirm modal — for a unified Sync Plan orchestrator that already got
     * one confirmation covering the whole plan (pushes/moves/deletions and
     * this download set together), so pulling shouldn't prompt a second time.
     */
    async applyPullBatch(
        files: Array<TFile | string>,
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[],
    ): Promise<SyncResult> {
        const tree = await this.resolveTree(remoteTree);
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
        const results: SyncResult = { success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, errors: [] };
        const tree = remoteTree ? new Map(remoteTree.map(entry => [entry.path, entry])) : undefined;
        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            if (!file) continue;
            const { path, name, isString } = this.dependencies.scanner.fileInfo(file);
            onProgress?.(index + 1, files.length, name);
            try {
                const outcome = await this.processFile(file, path, name, isString, tree);
                if (outcome === 'added') { results.success += 1; results.added += 1; }
                else if (outcome === 'updated') { results.success += 1; results.updated += 1; }
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
        if (!entry?.sha || entry.symlink) return 'modification';
        const decision = await this.planFromTree(file, path, isString, entry);
        return this.planKindFor(decision);
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
        const decision = await this.planFromRemote(file, path, isString, remote);
        if (decision.action === 'none') {
            await this.dependencies.updateMetadata(path, remote.sha);
            return 'unchanged';
        }
        if (decision.action === 'resolve-conflict') return 'conflict';
        const target = typeof file === 'string' ? { path, name } : file;
        await this.dependencies.executor.pull(target, remote.content, remote.sha, true, this.symlinkTarget(remote));
        return decision.action === 'pull-create' ? 'added' : 'updated';
    }

    private async classifyFromTree(
        file: TFile | string,
        path: string,
        isString: boolean,
        entry: GitTreeEntry,
    ): Promise<BatchOutcome | null> {
        if (entry.symlink || !entry.sha) return null;
        const decision = await this.planFromTree(file, path, isString, entry);
        if (decision.action === 'none') {
            await this.dependencies.updateMetadata(path, entry.sha);
            return 'unchanged';
        }
        return decision.action === 'resolve-conflict' ? 'conflict' : null;
    }

    private async planFromTree(
        file: TFile | string,
        path: string,
        isString: boolean,
        entry: GitTreeEntry,
    ): Promise<PlannedFileAction> {
        const repoPath = this.dependencies.scanner.toRepoPath(path);
        await this.dependencies.migrateBaseline(path, repoPath, entry);
        const exists = await this.fileExists(file);
        const kind = isBinaryPath(path) ? 'binary' : 'text';
        const localSha = exists ? await gitBlobSha(await this.dependencies.scanner.readContent(file)) : undefined;
        return this.planner.planFor('pull', {
            local: { path, exists, blobSha: localSha, kind },
            remote: { path, repoPath, exists: true, blobSha: entry.sha, kind },
            base: { blobSha: this.dependencies.settings.syncMetadata[path]?.lastSyncedSha },
        });
    }

    private async planFromRemote(
        file: TFile | string,
        path: string,
        isString: boolean,
        remote: GitFile,
    ): Promise<PlannedFileAction> {
        const exists = await this.fileExists(file);
        const kind = isBinaryPath(path) ? 'binary' : 'text';
        const localContent = exists ? await this.dependencies.scanner.readContent(file) : undefined;
        let localSha: string | undefined;
        if (localContent !== undefined) {
            localSha = contentsEqual(localContent, remote.content) ? remote.sha : await gitBlobSha(localContent);
        }
        const baseline = this.dependencies.settings.syncMetadata[path]?.lastSyncedSha;
        const blobBaseline = baseline === remote.revision ? remote.sha : baseline;
        return this.planner.planFor('pull', {
            local: { path, exists, blobSha: localSha, kind },
            remote: { path, repoPath: this.dependencies.scanner.toRepoPath(path), exists: true, blobSha: remote.sha, kind },
            base: { blobSha: blobBaseline },
        });
    }

    private planKindFor(decision: PlannedFileAction): PlanKind {
        if (decision.action === 'pull-create') return 'addition';
        if (decision.action === 'pull-overwrite') return 'modification';
        if (decision.action === 'resolve-conflict') return 'conflict';
        if (decision.action === 'none') return 'unchanged';
        return 'skip';
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

    private notifyResult(result: SyncResult): void {
        if (result.success > 0) {
            const service = this.dependencies.serviceName();
            const key = this.pullSummaryKey(result.added, result.updated);
            this.dependencies.notify(t(key, { service, added: result.added, updated: result.updated }));
        }
        if (result.conflicts > 0) {
            this.dependencies.notify(`Skipped ${result.conflicts} file(s) with conflicting changes on both sides. Push or pull each one individually to resolve.`, 8000);
        }
        if (result.failed > 0) this.dependencies.notify(`Failed to pull ${result.failed} file(s). Check console for details.`);
    }

    private pullSummaryKey(added: number, updated: number): 'sync.notice.pullSummary' | 'sync.notice.pullAddedOnly' | 'sync.notice.pullUpdatedOnly' {
        if (added > 0 && updated > 0) return 'sync.notice.pullSummary';
        return added > 0 ? 'sync.notice.pullAddedOnly' : 'sync.notice.pullUpdatedOnly';
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
