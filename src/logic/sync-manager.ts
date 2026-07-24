import { TFile, App, Notice } from 'obsidian';
import { GitServiceInterface, GitTreeEntry, BatchMoveItem } from '../services/git-service-interface';
import { MAX_BATCH_PUSH_SIZE } from '../services/git-service-base';
import { GitLabFilesPushSettings, getServiceName, getEffectiveSymlinkHandling } from '../settings';
import { SyncConflictModal } from '../ui/SyncConflictModal';
import { logger } from '../utils/logger';
import { isBinaryPath, contentsEqual } from '../utils/path';
import { readLocalSymlinkTarget, createLocalSymlink } from '../utils/symlink';
import { gitBlobSha } from '../utils/git-blob-sha';

/** Result of syncing one file within a batch push/pull. */
type BatchOutcome = 'done' | 'unchanged' | 'conflict';

/** A file classified as needing a push, queued for the grouped batch-commit call. */
type ToPushEntry = { path: string; name: string; repoPath: string; content: string | ArrayBuffer; existingSha?: string };

/** A renamed file classified as a safe move, queued for the grouped batch-commit call. */
type ToMoveEntry = { path: string; name: string; repoPath: string; oldPath: string; oldRepoPath: string; content: string | ArrayBuffer };

/**
 * Result of a batch push. `syncedPaths` lists every path that's now confirmed
 * synced (content just written matches what's now on the remote), with its
 * new blob sha when known. The caller uses this to mark those files' UI
 * status directly rather than re-fetching the remote tree right after a
 * write — GitHub's tree-by-branch-name read can lag a successful write by a
 * moment, so an immediate re-fetch can misreport a just-pushed file as
 * "modified" even though nothing is actually different.
 */
export type PushResults = {
    success: number;
    failed: number;
    conflicts: number;
    errors: Array<{ file: string; error: string }>;
    syncedPaths: Array<{ path: string; sha?: string }>;
};

export class SyncManager {
    private readonly app: App;
    private gitService: GitServiceInterface;
    private readonly settings: GitLabFilesPushSettings;
    private readonly onSaveSettings?: () => Promise<void>;

    constructor(app: App, gitService: GitServiceInterface, settings: GitLabFilesPushSettings, onSaveSettings?: () => Promise<void>) {
        this.app = app;
        this.gitService = gitService;
        this.settings = settings;
        this.onSaveSettings = onSaveSettings;
    }

    private get serviceName(): string {
        return getServiceName(this.settings);
    }

    public async updateMetadata(path: string, sha: string): Promise<void> {
        this.settings.syncMetadata[path] = {
            lastSyncedSha: sha,
            lastSyncedAt: Date.now(),
            lastKnownPath: path
        };
        await this.saveSettings();
    }

    /** Drop sync metadata for a path that's been deleted, so it can't be mistaken for a rename source later. */
    public async clearMetadata(path: string): Promise<void> {
        if (!(path in this.settings.syncMetadata)) return;
        delete this.settings.syncMetadata[path];
        await this.saveSettings();
    }

    /**
     * Records a vault 'rename' event so a later push recognizes it as a real
     * move — no content probing or remote lookup needed, Obsidian already
     * told us the exact old path. A file with no tracked metadata was never
     * synced, so there's nothing to carry forward: it's just a new file at a
     * new name.
     *
     * A chain of renames (A→B→C) collapses to a single pending move by always
     * recording the still-unpushed remote path, not the most recent hop; and
     * renaming back to that path (B→A) cancels the pending move entirely,
     * since the file is once again exactly what's on the remote.
     */
    public async trackRename(newPath: string, oldPath: string): Promise<void> {
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

        await this.saveSettings();
    }

    private getNormalizedPath(path: string): string {
        if (!this.settings.vaultFolder) return path;
        const folderPath = this.settings.vaultFolder + '/';
        if (path.startsWith(folderPath)) {
            return path.substring(folderPath.length);
        }
        if (path === this.settings.vaultFolder) return '';
        return path;
    }

    updateGitService(gitService: GitServiceInterface): void {
        this.gitService = gitService;
    }

    async pushFile(fileOrPath: TFile | string) {
        const { path, name, isString } = this.getFileInfo(fileOrPath);
        const repoPath = this.getNormalizedPath(path);

        if (!await this.checkFileExists(path, isString)) {
            new Notice(`File ${name} no longer exists in vault.`);
            return;
        }

        try {
            // Symbolic link handling: real → push as a symlink (GitHub), skip → ignore.
            const symlinkTarget = readLocalSymlinkTarget(this.app, path);
            if (symlinkTarget !== null && await this.handleSymlinkPush({ path, name }, symlinkTarget)) {
                return;
            }

            const content = await this.getFileContent(fileOrPath);

            // Check if this is a renamed file. A path already carrying
            // renamedFrom was tracked live by the vault 'rename' handler, so
            // it's known for free; only fall back to the content-based scan
            // for renames the plugin missed (e.g. it was disabled at the time).
            if (!isString && fileOrPath instanceof TFile) {
                const renamedFrom = this.settings.syncMetadata[path]?.renamedFrom ?? await this.detectRename(fileOrPath, content);
                if (renamedFrom) {
                    await this.handleRename(fileOrPath, renamedFrom, content);
                    return;
                }
            }

            // Conflict detection & equality check
            const remote = await this.gitService.getFile(repoPath, this.settings.branch);

            // "follow" must not silently convert a remote symlink into a regular
            // file. If the remote is a symlink, leave it untouched.
            if (remote.isSymlink) {
                new Notice(`${name} is a symlink on the remote; not overwriting (use "real" symlink mode to manage links).`);
                return;
            }

            if (remote.sha && this.contentsEqual(content, remote.content)) {
                await this.updateMetadata(path, remote.sha);
                new Notice(`${name} is already up to date.`);
                return;
            }

            const lastSynced = this.settings.syncMetadata[path];

            if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new SyncConflictModal(this.app, name, content as string, remote.content as string, (choice) => {
                    void (async () => {
                        try {
                            const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
                            if (choice === 'local') {
                                await this.performPush({ path, name }, content, remote.sha);
                            } else {
                                await this.performPull(fileRep, remote.content, remote.sha, false, this.symlinkPullTarget(remote));
                            }
                        } catch (e) {
                            this.handleError(`Failed to resolve conflict for ${name}`, e);
                        }
                    })();
                }).open();
                return;
            }

            await this.performPush({ path, name }, content, remote.sha);
        } catch (e) {
            this.handleError(`Failed to push ${name} to ${this.serviceName}`, e);
        }
    }

    /**
     * A missing local file at a tracked path is only weak evidence of a rename —
     * any orphaned metadata entry (e.g. from a local delete) matches it too. Only
     * report a rename once the remote content at the old path still matches the
     * content being pushed now, confirming it's really the same file that moved.
     *
     * Given a pre-fetched tree this costs no requests: the tree carries each
     * blob's sha, so one comparison against the local content's git blob sha
     * answers both "is the old path still on the remote" and "is it the same
     * bytes" (`contentsEqual` is exact equality, so the two agree). Without a
     * tree every candidate needs its own `getFile`, and a candidate the remote
     * no longer has 404s — which is why the batch push must pass its tree in
     * rather than re-probing the same dead paths once per file being pushed.
     */
    private async detectRename(
        file: TFile,
        content: string | ArrayBuffer,
        treeByFullPath?: Map<string, GitTreeEntry>
    ): Promise<string | null> {
        const localSha = treeByFullPath ? await gitBlobSha(content) : undefined;
        for (const oldPath of Object.keys(this.settings.syncMetadata)) {
            const metadata = this.settings.syncMetadata[oldPath];
            if (!metadata || oldPath === file.path || metadata.lastKnownPath !== oldPath) continue;
            if (this.app.vault.getFileByPath(oldPath)) continue;

            const oldRepoPath = this.getNormalizedPath(oldPath);
            const treeMatch = this.matchRenameFromTree(localSha, oldRepoPath, treeByFullPath);
            if (treeMatch === true) return oldPath;
            if (treeMatch === false) continue;

            const remoteAtOldPath = await this.gitService.getFile(oldRepoPath, this.settings.branch);
            if (remoteAtOldPath.sha && this.contentsEqual(content, remoteAtOldPath.content)) return oldPath;
        }
        return null;
    }

    private matchRenameFromTree(
        localSha: string | undefined,
        oldRepoPath: string,
        treeByFullPath: Map<string, GitTreeEntry> | undefined
    ): boolean | undefined {
        if (!treeByFullPath) return undefined;
        const entry = treeByFullPath.get(this.getFullPathForTree(oldRepoPath));
        if (!entry || entry.symlink) return false;
        return entry.sha ? entry.sha === localSha : undefined;
    }

    /**
     * Commits a rename as a real move: the new path is added and the old path
     * is removed in one commit (via commitBatch where the provider supports
     * it, otherwise a sequential push-then-delete). Two safety checks guard
     * against destroying data:
     *
     * - The target path must not already exist on the remote — that would be
     *   a silent overwrite of someone else's file, so this bails out entirely
     *   and leaves the pending move in place for the user to resolve.
     * - The old path's remote content must still match what was last synced
     *   there. If it doesn't, someone changed the remote since — deleting it
     *   would discard a change we've never seen, so the new content is still
     *   pushed (nothing local is lost) but the old path is left alone.
     */
    private async handleRename(file: TFile, oldPath: string, content: string | ArrayBuffer): Promise<void> {
        try {
            const repoPath = this.getNormalizedPath(file.path);
            const oldRepoPath = this.getNormalizedPath(oldPath);
            const metadata = this.settings.syncMetadata[file.path] ?? this.settings.syncMetadata[oldPath];

            const existingAtNewPath = await this.gitService.getFile(repoPath, this.settings.branch);
            if (existingAtNewPath.sha) {
                new Notice(`Can't move ${file.name}: "${repoPath}" already exists on ${this.serviceName}. Resolve manually, then push again.`);
                return;
            }

            const remoteAtOldPath = await this.gitService.getFile(oldRepoPath, this.settings.branch);
            const safeToDeleteOld = !remoteAtOldPath.sha || !metadata?.lastSyncedSha || remoteAtOldPath.sha === metadata.lastSyncedSha;

            const newSha = await this.commitMove(repoPath, oldRepoPath, content, safeToDeleteOld && !!remoteAtOldPath.sha);

            await this.updateMetadata(file.path, newSha);
            delete this.settings.syncMetadata[oldPath];
            await this.saveSettings();

            if (safeToDeleteOld) {
                new Notice(`Moved ${file.name} on ${this.serviceName}`);
            } else {
                new Notice(`Pushed ${file.name} to ${this.serviceName}, but "${oldPath}" changed on ${this.serviceName} since the last sync and was left in place. Resolve manually.`);
            }
        } catch (e) {
            this.handleError('Failed to handle rename', e);
            throw e; // Rethrow for batch processing
        }
    }

    /** Commits one move (single-file flow only; the batch flow groups many moves into one commit via commitBatch directly). */
    private async commitMove(repoPath: string, oldRepoPath: string, content: string | ArrayBuffer, deleteOld: boolean): Promise<string> {
        if (this.gitService.commitBatch) {
            const message = deleteOld ? `Move ${oldRepoPath} to ${repoPath}` : `Add ${repoPath}`;
            const moves: BatchMoveItem[] = deleteOld ? [{ oldPath: oldRepoPath, newPath: repoPath, content }] : [];
            const additions = deleteOld ? [] : [{ path: repoPath, content }];
            const [result] = await this.gitService.commitBatch(additions, moves, this.settings.branch, message);
            return result?.sha ?? await gitBlobSha(content);
        }

        const pushResult = await this.gitService.pushFile(repoPath, content, this.settings.branch, `Move ${oldRepoPath} to ${repoPath}`);
        const newSha = pushResult.sha ?? await gitBlobSha(content);
        if (deleteOld) {
            await this.gitService.deleteFile(oldRepoPath, this.settings.branch, `Remove ${oldRepoPath} (moved to ${repoPath})`);
        }
        return newSha;
    }

    private async performPush(file: {path: string, name: string}, content: string | ArrayBuffer, existingSha?: string, silent = false): Promise<string | undefined> {
        const repoPath = this.getNormalizedPath(file.path);
        const result = await this.gitService.pushFile(
            repoPath,
            content,
            this.settings.branch,
            `Update ${file.name} from Obsidian`,
            existingSha
        );

        // Update metadata
        const newSha = result.sha ?? await gitBlobSha(content);
        await this.updateMetadata(file.path, newSha);

        if (!silent) new Notice(`Pushed ${file.name} to ${this.serviceName}`);
        return newSha;
    }

    /**
     * Handles pushing a local symbolic link per the configured behavior.
     * Returns true if the link was handled (pushed as a symlink, or intentionally
     * skipped); returns false to let the caller fall through to a normal content
     * push ("follow", which reads through the link).
     */
    private async handleSymlinkPush(file: {path: string, name: string}, target: string, silent = false): Promise<boolean> {
        const mode = getEffectiveSymlinkHandling(this.settings);
        if (mode === 'skip') {
            if (!silent) new Notice(`Skipped symlink ${file.name}.`);
            return true;
        }
        if (mode === 'real' && this.gitService.pushSymlink) {
            const repoPath = this.getNormalizedPath(file.path);
            const result = await this.gitService.pushSymlink(repoPath, target, this.settings.branch, `Update ${file.name} from Obsidian`);
            if (result.sha) await this.updateMetadata(file.path, result.sha);
            if (!silent) new Notice(`Pushed symlink ${file.name} to ${this.serviceName}`);
            return true;
        }
        return false;
    }

    /** The symlink target to recreate on pull, or undefined when the remote isn't a symlink. */
    private symlinkPullTarget(remote: { isSymlink?: boolean; symlinkTarget?: string }): string | undefined {
        return remote.isSymlink ? remote.symlinkTarget ?? '' : undefined;
    }

    async pullFile(fileOrPath: TFile | string) {
        const { path, name, isString } = this.getFileInfo(fileOrPath);
        const repoPath = this.getNormalizedPath(path);

        try {
            const remote = await this.gitService.getFile(repoPath, this.settings.branch);
            if (!remote.sha) {
                new Notice(`File ${name} not found on remote.`);
                return;
            }

            const exists = await this.checkFileExists(path, isString);
            const localContent = exists ? await this.getFileContent(fileOrPath) : null;
            const lastSynced = this.settings.syncMetadata[path];

            if (exists && localContent !== null && this.contentsEqual(localContent, remote.content)) {
                // Still update metadata even if content matches
                await this.updateMetadata(path, remote.sha);
                new Notice(`${name} is already up to date.`);
                return;
            }

            // Conflict detection for pull (only if local exists)
            if (exists && remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new SyncConflictModal(this.app, name, (localContent as string) || '', remote.content as string, (choice) => {
                    void (async () => {
                        try {
                            const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
                            if (choice === 'local') {
                                await this.performPush(fileRep, localContent || '', remote.sha);
                            } else {
                                await this.performPull(fileRep, remote.content, remote.sha, false, this.symlinkPullTarget(remote));
                            }
                        } catch (e) {
                            this.handleError(`Failed to resolve conflict for ${name}`, e);
                        }
                    })();
                }).open();
                return;
            }

            const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
            await this.performPull(fileRep, remote.content, remote.sha);
        } catch (e) {
            this.handleError(`Failed to pull ${name} from ${this.serviceName}`, e);
        }
    }

    private contentsEqual(a: string | ArrayBuffer, b: string | ArrayBuffer): boolean {
        return contentsEqual(a, b);
    }

    private isBinary(path: string): boolean {
        return isBinaryPath(path);
    }

    private async performPull(file: TFile | {path: string, name: string}, remoteContent: string | ArrayBuffer, remoteSha: string, silent = false, symlinkTarget?: string) {
        await this.ensureParentDirs(file.path);

        if (symlinkTarget !== undefined) {
            // Remote blob is a symbolic link. Recreate a real OS link when the
            // setting is "real" and the platform supports it…
            if (getEffectiveSymlinkHandling(this.settings) === 'real' && createLocalSymlink(this.app, file.path, symlinkTarget)) {
                await this.updateMetadata(file.path, remoteSha);
                if (!silent) new Notice(`Pulled symlink ${file.name} from ${this.serviceName}`);
                return;
            }
            // …otherwise record where it pointed by writing the target as content.
            remoteContent = symlinkTarget;
        }

        await this.writePulledContent(file, remoteContent);
        await this.updateMetadata(file.path, remoteSha);
        if (!silent) new Notice(`Pulled ${file.name} from ${this.serviceName}`);
    }

    private async writePulledContent(file: TFile | {path: string, name: string}, remoteContent: string | ArrayBuffer): Promise<void> {
        if (typeof remoteContent !== 'string') {
            if (file instanceof TFile) {
                await this.app.vault.modifyBinary(file, remoteContent);
            } else {
                await this.app.vault.adapter.writeBinary(file.path, remoteContent);
            }
        } else if (file instanceof TFile) {
            await this.app.vault.modify(file, remoteContent);
        } else {
            await this.app.vault.adapter.write(file.path, remoteContent);
        }
    }

    private async ensureParentDirs(filePath: string): Promise<void> {
        const parts = filePath.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
            cur += (i > 0 ? '/' : '') + parts[i];
            try {
                await this.app.vault.adapter.mkdir(cur);
            } catch {
                // already exists or failed
            }
        }
    }

    private async saveSettings() {
        if (this.onSaveSettings) {
            await this.onSaveSettings();
        }
    }

    private handleError(message: string, error: unknown): void {
        logger.error(message, error);
        const detail = error instanceof Error ? error.message : String(error);
        new Notice(`${message}: ${detail}`);
    }

    async pushAllFiles(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<PushResults> {
        return this.processPushBatch(files, onProgress, remoteTree);
    }

    async pullAllFiles(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<{ success: number; failed: number; conflicts: number; errors: Array<{ file: string; error: string }> }> {
        return this.processPullBatch(files, onProgress, remoteTree);
    }

    private async processPullBatch(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<{ success: number; failed: number; conflicts: number; errors: Array<{ file: string; error: string }> }> {
        const results = { success: 0, failed: 0, conflicts: 0, errors: [] as Array<{ file: string; error: string }> };

        // One tree read decides which files actually need downloading; without it
        // (a failed fetch) every file falls back to its own content request.
        let treeByFullPath: Map<string, GitTreeEntry> | undefined;
        try {
            const tree = remoteTree ?? await this.gitService.listFilesDetailed(this.settings.branch, false);
            treeByFullPath = new Map(tree.map(e => [e.path, e]));
        } catch (e) {
            logger.warn('Failed to fetch remote tree for pull; falling back to per-file fetches', e);
        }

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const { path, name, isString } = this.getFileInfo(fileOrPath);
            onProgress?.(i + 1, files.length, name);

            try {
                const outcome = await this.processSingleBatchPull(fileOrPath, path, name, isString, treeByFullPath);
                if (outcome === 'done') results.success++;
                else if (outcome === 'conflict') results.conflicts++;
            } catch (e) {
                logger.error(`Failed to pull ${path}:`, e);
                results.failed++;
                results.errors.push({ file: path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        await this.saveSettings();
        this.notifyBatchResult('pull', results.success, results.failed, results.conflicts);

        return results;
    }

    private async processPushBatch(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<PushResults> {
        const results: PushResults = { success: 0, failed: 0, conflicts: 0, errors: [], syncedPaths: [] };

        const tree = remoteTree ?? await this.gitService.listFilesDetailed(this.settings.branch, false);
        const treeByFullPath = new Map<string, GitTreeEntry>(tree.map(e => [e.path, e]));
        const toPush: ToPushEntry[] = [];
        const toMove: ToMoveEntry[] = [];
        // Computed once per batch rather than per file: the fallback rename
        // scan is only worth running at all when some metadata entry has no
        // matching local file. Most files carry a tracked renamedFrom (set live
        // by the vault 'rename' handler) or aren't renamed at all, so this
        // avoids an Object.keys(syncMetadata) walk for every file in the batch.
        const hasOrphans = this.hasOrphanedRenameMetadata();

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const { path, name, isString } = this.getFileInfo(fileOrPath);
            onProgress?.(i + 1, files.length, name);

            try {
                const outcome = await this.classifyPushCandidate(fileOrPath, path, name, isString, treeByFullPath, toPush, toMove, hasOrphans);
                if (outcome === 'done') {
                    results.success++;
                    // Symlink pushes are committed immediately outside the
                    // toPush queue, so the new sha isn't known here — the caller
                    // still gets to mark the path synced, just without a sha update.
                    results.syncedPaths.push({ path });
                }
                else if (outcome === 'conflict') results.conflicts++;
                // 'unchanged' and 'queued'/'queued-move' don't move any of the
                // counters directly: 'unchanged' never did, and the queued
                // outcomes are resolved by commitPushBatch below.
            } catch (e) {
                logger.error(`Failed to push ${path}:`, e);
                results.failed++;
                results.errors.push({ file: path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        if (toPush.length > 0 || toMove.length > 0) {
            await this.commitPushBatch(toPush, toMove, results);
        }

        await this.saveSettings();
        this.notifyBatchResult('push', results.success, results.failed, results.conflicts);

        return results;
    }

    /** Whether any syncMetadata entry no longer has a matching local file — the only case detectRename's fallback scan can find anything. */
    private hasOrphanedRenameMetadata(): boolean {
        for (const trackedPath of Object.keys(this.settings.syncMetadata)) {
            const metadata = this.settings.syncMetadata[trackedPath];
            if (!metadata || metadata.lastKnownPath !== trackedPath) continue;
            if (!this.app.vault.getFileByPath(trackedPath)) return true;
        }
        return false;
    }

    /**
     * Classifies one file for the batch-push flow using a purely local
     * comparison (git blob sha vs. the pre-fetched remote tree's blob sha) —
     * no getFile network call. Symlinks are pushed immediately and never
     * queued; a confirmed rename is queued into `toMove` so it lands in the
     * same commit as everything else; everything else is either resolved
     * immediately ('unchanged'/'conflict') or appended to `toPush`.
     */
    private async classifyPushCandidate(
        fileOrPath: TFile | string,
        path: string,
        name: string,
        isString: boolean,
        treeByFullPath: Map<string, GitTreeEntry>,
        toPush: ToPushEntry[],
        toMove: ToMoveEntry[],
        hasOrphans: boolean
    ): Promise<BatchOutcome | 'queued'> {
        if (!await this.checkFileExists(path, isString)) throw new Error('File no longer exists');

        // Symbolic link handling: real → push as a symlink (GitHub), skip → ignore.
        const symlinkTarget = readLocalSymlinkTarget(this.app, path);
        if (symlinkTarget !== null && await this.handleSymlinkPush({ path, name }, symlinkTarget, true)) {
            return getEffectiveSymlinkHandling(this.settings) !== 'skip' ? 'done' : 'unchanged';
        }

        const content = await this.getFileContent(fileOrPath);
        const repoPath = this.getNormalizedPath(path);

        // Rename detection: a tracked renamedFrom is free (set live by the
        // vault 'rename' handler); the content-based scan is only a fallback
        // for renames the plugin missed, and only worth running when an
        // orphaned metadata entry actually exists.
        if (!isString && fileOrPath instanceof TFile) {
            const trackedOldPath = this.settings.syncMetadata[path]?.renamedFrom;
            const renamedFrom = trackedOldPath ?? (hasOrphans ? await this.detectRename(fileOrPath, content, treeByFullPath) : null);
            if (renamedFrom) {
                return this.queueMove(path, name, renamedFrom, content, treeByFullPath, toMove);
            }
        }

        const treeEntry = treeByFullPath.get(this.getFullPathForTree(repoPath));
        const outcome = await this.classifyAgainstTreeEntry(path, content, treeEntry);
        if (outcome !== 'queued') return outcome;

        toPush.push({ path, name, repoPath, content, existingSha: treeEntry?.sha });
        return 'queued';
    }

    /**
     * Decides a confirmed rename's outcome purely from the pre-fetched tree —
     * no network call — and queues it for the grouped commit. Mirrors the two
     * safety checks handleRename applies to the single-file flow: a target
     * that already exists on the remote is never silently overwritten, and an
     * old path whose remote content has moved on since the last sync is never
     * silently deleted. Both surface as 'conflict' so the batch can't quietly
     * clobber either side the way a plain content push already refuses to.
     */
    private queueMove(
        path: string,
        name: string,
        oldPath: string,
        content: string | ArrayBuffer,
        treeByFullPath: Map<string, GitTreeEntry>,
        toMove: ToMoveEntry[]
    ): BatchOutcome | 'queued' {
        const repoPath = this.getNormalizedPath(path);
        const oldRepoPath = this.getNormalizedPath(oldPath);

        if (treeByFullPath.get(this.getFullPathForTree(repoPath))) return 'conflict';

        const oldEntry = treeByFullPath.get(this.getFullPathForTree(oldRepoPath));
        const metadata = this.settings.syncMetadata[path] ?? this.settings.syncMetadata[oldPath];
        const safeToDeleteOld = !oldEntry?.sha || !metadata?.lastSyncedSha || oldEntry.sha === metadata.lastSyncedSha;
        if (oldEntry?.sha && !safeToDeleteOld) return 'conflict';

        toMove.push({ path, name, repoPath, oldPath, oldRepoPath, content });
        return 'queued';
    }

    /**
     * Decides a non-symlink, non-renamed file's outcome purely from a
     * pre-fetched tree entry and a locally-computed git blob sha — no network
     * call. Split out of classifyPushCandidate to keep both under the
     * cognitive-complexity limit.
     */
    private async classifyAgainstTreeEntry(
        path: string,
        content: string | ArrayBuffer,
        treeEntry: GitTreeEntry | undefined
    ): Promise<BatchOutcome | 'queued'> {
        // Don't convert a remote symlink into a regular file.
        if (treeEntry?.symlink) return 'unchanged';

        // Skip if already in sync — compared locally, no network round trip.
        if (treeEntry?.sha) {
            const localSha = await gitBlobSha(content);
            if (localSha === treeEntry.sha) {
                await this.updateMetadata(path, treeEntry.sha);
                return 'unchanged';
            }
        }

        // Same conflict check as the single-file flow: if the remote has moved on
        // from what we last synced, overwriting it here would silently discard
        // whatever changed on the remote. Skip it instead of force-pushing so the
        // batch action can't quietly clobber changes the way a single push would
        // stop and ask about via SyncConflictModal.
        const lastSynced = this.settings.syncMetadata[path];
        if (treeEntry?.sha && lastSynced && treeEntry.sha !== lastSynced.lastSyncedSha) {
            return 'conflict';
        }

        return 'queued';
    }

    /**
     * Path relative to rootPath, matching how each git service's getFullPath
     * would resolve `repoPath` — mirrors that logic locally so pre-fetched tree
     * entries (always full repo paths) can be looked up without depending on
     * each service's protected getFullPath.
     */
    private getFullPathForTree(repoPath: string): string {
        if (repoPath.startsWith('/')) return repoPath.slice(1);
        const rootPath = this.settings.rootPath;
        if (!rootPath) return repoPath;
        const cleanRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
        if (repoPath.startsWith(cleanRoot)) return repoPath;
        return cleanRoot + repoPath;
    }

    /**
     * Commits every queued file (and every queued move) in one or more
     * grouped batch-commit calls. When both are present they're chunked and
     * committed together via commitBatch, so a push-all that both edits and
     * moves files produces one commit per chunk, not one commit per kind.
     */
    private async commitPushBatch(toPush: ToPushEntry[], toMove: ToMoveEntry[], results: PushResults): Promise<void> {
        if (toMove.length === 0) {
            if (!this.gitService.pushBatch) {
                await this.pushSequentialFallback(toPush, results);
                return;
            }
            for (let i = 0; i < toPush.length; i += MAX_BATCH_PUSH_SIZE) {
                await this.commitOneChunk(toPush.slice(i, i + MAX_BATCH_PUSH_SIZE), results);
            }
            return;
        }

        if (!this.gitService.commitBatch) {
            // Sequential fallback for providers without an atomic multi-file
            // commit: each move is its own push-then-delete (mirrors the
            // single-file flow), and plain pushes go through the existing
            // sequential fallback.
            await this.moveSequentialFallback(toMove, results);
            await this.pushSequentialFallback(toPush, results);
            return;
        }

        const combined: Array<{ kind: 'push'; entry: ToPushEntry } | { kind: 'move'; entry: ToMoveEntry }> = [
            ...toPush.map(entry => ({ kind: 'push' as const, entry })),
            ...toMove.map(entry => ({ kind: 'move' as const, entry })),
        ];
        for (let i = 0; i < combined.length; i += MAX_BATCH_PUSH_SIZE) {
            await this.commitCombinedChunk(combined.slice(i, i + MAX_BATCH_PUSH_SIZE), results);
        }
    }

    /** Provider doesn't support a batch/atomic multi-file commit — fall back to
     * the same sequential per-file push used by the single-file flow. */
    private async pushSequentialFallback(toPush: ToPushEntry[], results: PushResults): Promise<void> {
        for (const f of toPush) {
            try {
                const sha = await this.performPush({ path: f.path, name: f.name }, f.content, f.existingSha, true);
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            } catch (e) {
                results.failed++;
                results.errors.push({ file: f.path, error: e instanceof Error ? e.message : String(e) });
            }
        }
    }

    /** Provider doesn't support commitBatch — each queued move becomes its own push-then-delete commit. */
    private async moveSequentialFallback(toMove: ToMoveEntry[], results: PushResults): Promise<void> {
        for (const f of toMove) {
            try {
                const pushResult = await this.gitService.pushFile(f.repoPath, f.content, this.settings.branch, `Move ${f.oldRepoPath} to ${f.repoPath}`);
                const sha = pushResult.sha ?? await gitBlobSha(f.content);
                await this.gitService.deleteFile(f.oldRepoPath, this.settings.branch, `Remove ${f.oldRepoPath} (moved to ${f.repoPath})`);
                await this.updateMetadata(f.path, sha);
                delete this.settings.syncMetadata[f.oldPath];
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            } catch (e) {
                results.failed++;
                results.errors.push({ file: f.path, error: e instanceof Error ? e.message : String(e) });
            }
        }
    }

    private async commitOneChunk(chunk: ToPushEntry[], results: PushResults): Promise<void> {
        try {
            const commitMessage = `Push ${chunk.length} file(s) from Obsidian`;
            const batchResults = await this.gitService.pushBatch!(
                chunk.map(f => ({ path: f.repoPath, content: f.content, existedRemotely: !!f.existingSha })),
                this.settings.branch,
                commitMessage
            );
            const shaByPath = new Map(batchResults.map(r => [r.path, r.sha]));
            for (const f of chunk) {
                // GitHub's createCommitOnBranch reports only the commit oid, so
                // the provider returns no per-file sha. The content we just
                // committed hashes to exactly what the remote now holds, so
                // derive it locally — leaving the metadata stale would make the
                // next push read the remote as "moved since last sync" and skip
                // the file as a conflict.
                const sha = shaByPath.get(f.repoPath) ?? await gitBlobSha(f.content);
                await this.updateMetadata(f.path, sha);
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            }
        } catch (e) {
            // Atomic per-provider failure: none of this chunk's files were
            // actually written, so every file in it is failed, not dropped.
            const message = e instanceof Error ? e.message : String(e);
            for (const f of chunk) {
                results.failed++;
                results.errors.push({ file: f.path, error: message });
            }
        }
    }

    private combinedChunkCommitMessage(pushCount: number, moveCount: number): string {
        if (moveCount === 0) return `Push ${pushCount} file(s) from Obsidian`;
        if (pushCount === 0) return `Move ${moveCount} file(s) from Obsidian`;
        return `Push ${pushCount} file(s) and move ${moveCount} file(s) from Obsidian`;
    }

    /** Commits a chunk mixing plain pushes and moves in one commitBatch call — one commit for the whole chunk regardless of kind. */
    private async commitCombinedChunk(
        chunk: Array<{ kind: 'push'; entry: ToPushEntry } | { kind: 'move'; entry: ToMoveEntry }>,
        results: PushResults
    ): Promise<void> {
        const pushEntries = chunk.filter((c): c is { kind: 'push'; entry: ToPushEntry } => c.kind === 'push').map(c => c.entry);
        const moveEntries = chunk.filter((c): c is { kind: 'move'; entry: ToMoveEntry } => c.kind === 'move').map(c => c.entry);

        try {
            const commitMessage = this.combinedChunkCommitMessage(pushEntries.length, moveEntries.length);

            const batchResults = await this.gitService.commitBatch!(
                pushEntries.map(f => ({ path: f.repoPath, content: f.content, existedRemotely: !!f.existingSha })),
                moveEntries.map(f => ({ oldPath: f.oldRepoPath, newPath: f.repoPath, content: f.content })),
                this.settings.branch,
                commitMessage
            );
            const shaByPath = new Map(batchResults.map(r => [r.path, r.sha]));

            for (const f of pushEntries) {
                const sha = shaByPath.get(f.repoPath) ?? await gitBlobSha(f.content);
                await this.updateMetadata(f.path, sha);
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            }
            for (const f of moveEntries) {
                const sha = shaByPath.get(f.repoPath) ?? await gitBlobSha(f.content);
                await this.updateMetadata(f.path, sha);
                delete this.settings.syncMetadata[f.oldPath];
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            for (const c of chunk) {
                results.failed++;
                results.errors.push({ file: c.entry.path, error: message });
            }
        }
    }

    private notifyBatchResult(op: 'push' | 'pull', success: number, failed: number, conflicts: number): void {
        const opName = op === 'push' ? 'Pushed' : 'Pulled';
        if (success > 0) {
            new Notice(`${opName} ${success} file(s) to ${this.serviceName}`);
        }
        if (conflicts > 0) {
            new Notice(`Skipped ${conflicts} file(s) with conflicting changes on both sides. Push or pull each one individually to resolve.`, 8000);
        }
        if (failed > 0) {
            new Notice(`Failed to ${op} ${failed} file(s). Check console for details.`);
        }
    }

    private getFileInfo(fileOrPath: TFile | string) {
        const isString = typeof fileOrPath === 'string';
        const path = isString ? fileOrPath : fileOrPath.path;
        const name = isString ? path.split('/').pop() || path : fileOrPath.name;
        return { path, name, isString };
    }

    private async checkFileExists(path: string, isString: boolean): Promise<boolean> {
        if (isString) {
            return await this.app.vault.adapter.exists(path);
        }
        return !!this.app.vault.getFileByPath(path);
    }

    private async getFileContent(fileOrPath: TFile | string): Promise<string | ArrayBuffer> {
        const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
        const binary = this.isBinary(path);

        if (typeof fileOrPath === 'string') {
            return binary
                ? await this.app.vault.adapter.readBinary(fileOrPath)
                : await this.app.vault.adapter.read(fileOrPath);
        }
        try {
            return binary
                ? await this.app.vault.readBinary(fileOrPath)
                : await this.app.vault.read(fileOrPath);
        } catch (e) {
            // Obsidian's cached vault.read can fail for symlinked files (notably
            // on mobile); fall back to reading the path directly via the adapter.
            logger.warn(`vault.read failed for ${path}; falling back to adapter`, e);
            return binary
                ? await this.app.vault.adapter.readBinary(path)
                : await this.app.vault.adapter.read(path);
        }
    }

    private async processSingleBatchPull(
        fileOrPath: TFile | string,
        path: string,
        name: string,
        isString: boolean,
        treeByFullPath?: Map<string, GitTreeEntry>
    ): Promise<BatchOutcome> {
        const repoPath = this.getNormalizedPath(path);

        if (treeByFullPath) {
            const entry = treeByFullPath.get(this.getFullPathForTree(repoPath));
            if (!entry) throw new Error('File not found in remote');
            const decided = await this.classifyPullAgainstTreeEntry(fileOrPath, path, isString, entry);
            if (decided) return decided;
        }

        const remote = await this.gitService.getFile(repoPath, this.settings.branch);
        if (!remote.sha) throw new Error('File not found in remote');

        const exists = await this.checkFileExists(path, isString);
        if (exists) {
            const localContent = await this.getFileContent(fileOrPath);
            if (this.contentsEqual(localContent, remote.content)) {
                await this.updateMetadata(path, remote.sha);
                return 'unchanged';
            }

            // Same conflict check as the single-file flow (see processSingleBatchPush).
            const lastSynced = this.settings.syncMetadata[path];
            if (lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                return 'conflict';
            }
        }

        const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
        await this.performPull(fileRep, remote.content, remote.sha, true, this.symlinkPullTarget(remote));
        return 'done';
    }

    /**
     * The outcome of a pull that's decidable from the tree entry alone, or null
     * when the file's content is genuinely needed. Downloading a file only to
     * discover it already matches costs one request per file, so an in-sync
     * "pull all" would re-fetch the whole vault; the entry's blob sha answers
     * that locally, exactly as the push side already does.
     */
    private async classifyPullAgainstTreeEntry(
        fileOrPath: TFile | string,
        path: string,
        isString: boolean,
        entry: GitTreeEntry
    ): Promise<BatchOutcome | null> {
        // A symlink's blob is its target path, and an entry without a sha can't
        // be compared — both still need the real fetch.
        if (entry.symlink || !entry.sha) return null;
        // Nothing local to compare against: it has to be written.
        if (!await this.checkFileExists(path, isString)) return null;

        const localSha = await gitBlobSha(await this.getFileContent(fileOrPath));
        if (localSha === entry.sha) {
            await this.updateMetadata(path, entry.sha);
            return 'unchanged';
        }

        // Same conflict check as the content path below: local differs and the
        // remote has moved since we last synced, so pulling would discard one of
        // the two changes.
        const lastSynced = this.settings.syncMetadata[path];
        if (lastSynced && entry.sha !== lastSynced.lastSyncedSha) return 'conflict';

        return null;
    }
}
