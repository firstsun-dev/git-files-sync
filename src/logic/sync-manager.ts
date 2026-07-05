import { TFile, App, Notice } from 'obsidian';
import { GitServiceInterface } from '../services/git-service-interface';
import { GitLabFilesPushSettings, getServiceName, getEffectiveSymlinkHandling } from '../settings';
import { SyncConflictModal } from '../ui/SyncConflictModal';
import { logger } from '../utils/logger';
import { isBinaryPath, contentsEqual } from '../utils/path';
import { readLocalSymlinkTarget, createLocalSymlink } from '../utils/symlink';

/** Result of syncing one file within a batch push/pull. */
type BatchOutcome = 'done' | 'unchanged' | 'conflict';

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

            // Check if this is a renamed file
            if (!isString && fileOrPath instanceof TFile) {
                const renamedFrom = await this.detectRename(fileOrPath, content);
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
     */
    private async detectRename(file: TFile, content: string | ArrayBuffer): Promise<string | null> {
        const metadataEntries = Object.keys(this.settings.syncMetadata);
        for (const oldPath of metadataEntries) {
            const metadata = this.settings.syncMetadata[oldPath];
            if (!metadata) continue;
            if (oldPath === file.path || metadata.lastKnownPath !== oldPath) continue;
            if (this.app.vault.getFileByPath(oldPath)) continue;

            const oldRepoPath = this.getNormalizedPath(oldPath);
            const remoteAtOldPath = await this.gitService.getFile(oldRepoPath, this.settings.branch);
            if (remoteAtOldPath.sha && this.contentsEqual(content, remoteAtOldPath.content)) {
                return oldPath;
            }
        }
        return null;
    }

    private async handleRename(file: TFile, oldPath: string, content: string | ArrayBuffer): Promise<void> {
        try {
            const repoPath = this.getNormalizedPath(file.path);
            const oldRepoPath = this.getNormalizedPath(oldPath);

            // The new path may already exist on the remote (e.g. a prior push, or a
            // stale rename match); if so we must send its sha or the API rejects the
            // request as a duplicate create.
            const existingAtNewPath = await this.gitService.getFile(repoPath, this.settings.branch);

            // Push the file to the new location
            const result = await this.gitService.pushFile(
                repoPath,
                content,
                this.settings.branch,
                `Rename ${oldRepoPath} to ${repoPath}`,
                existingAtNewPath.sha
            );

            // Update metadata
            let newSha = result.sha;
            if (!newSha) {
                const newRemote = await this.gitService.getFile(repoPath, this.settings.branch);
                newSha = newRemote.sha;
            }
            
            if (newSha) await this.updateMetadata(file.path, newSha);

            // Remove old metadata
            delete this.settings.syncMetadata[oldPath];

            await this.saveSettings();
            new Notice(`Renamed and pushed ${file.name} to ${this.serviceName}\nNote: Old file at ${oldPath} may need manual deletion from remote`);
        } catch (e) {
            this.handleError('Failed to handle rename', e);
            throw e; // Rethrow for batch processing
        }
    }

    private async performPush(file: {path: string, name: string}, content: string | ArrayBuffer, existingSha?: string, silent = false) {
        const repoPath = this.getNormalizedPath(file.path);
        const result = await this.gitService.pushFile(
            repoPath,
            content,
            this.settings.branch,
            `Update ${file.name} from Obsidian`,
            existingSha
        );

        // Update metadata
        let newSha = result.sha;
        if (!newSha) {
            const newRemote = await this.gitService.getFile(repoPath, this.settings.branch);
            newSha = newRemote.sha;
        }

        if (newSha) await this.updateMetadata(file.path, newSha);

        if (!silent) new Notice(`Pushed ${file.name} to ${this.serviceName}`);
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

    async pushAllFiles(files: (TFile | string)[], onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ success: number; failed: number; conflicts: number; errors: Array<{ file: string; error: string }> }> {
        return this.processBatch(files, 'push', onProgress);
    }

    async pullAllFiles(files: (TFile | string)[], onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ success: number; failed: number; conflicts: number; errors: Array<{ file: string; error: string }> }> {
        return this.processBatch(files, 'pull', onProgress);
    }

    private async processBatch(
        files: (TFile | string)[],
        op: 'push' | 'pull',
        onProgress?: (current: number, total: number, fileName: string) => void
    ): Promise<{ success: number; failed: number; conflicts: number; errors: Array<{ file: string; error: string }> }> {
        const results = { success: 0, failed: 0, conflicts: 0, errors: [] as Array<{ file: string; error: string }> };

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const { path, name, isString } = this.getFileInfo(fileOrPath);
            onProgress?.(i + 1, files.length, name);

            try {
                const outcome = op === 'push'
                    ? await this.processSingleBatchPush(fileOrPath, path, name, isString)
                    : await this.processSingleBatchPull(fileOrPath, path, name, isString);

                if (outcome === 'done') results.success++;
                else if (outcome === 'conflict') results.conflicts++;
            } catch (e) {
                logger.error(`Failed to ${op} ${path}:`, e);
                results.failed++;
                results.errors.push({ file: path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        await this.saveSettings();
        this.notifyBatchResult(op, results.success, results.failed, results.conflicts);

        return results;
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

    private async processSingleBatchPush(fileOrPath: TFile | string, path: string, name: string, isString: boolean): Promise<BatchOutcome> {
        if (!await this.checkFileExists(path, isString)) throw new Error('File no longer exists');

        // Symbolic link handling: real → push as a symlink (GitHub), skip → ignore.
        const symlinkTarget = readLocalSymlinkTarget(this.app, path);
        if (symlinkTarget !== null && await this.handleSymlinkPush({ path, name }, symlinkTarget, true)) {
            return getEffectiveSymlinkHandling(this.settings) !== 'skip' ? 'done' : 'unchanged';
        }

        const content = await this.getFileContent(fileOrPath);
        const repoPath = this.getNormalizedPath(path);

        // Rename detection
        if (!isString && fileOrPath instanceof TFile) {
            const renamedFrom = await this.detectRename(fileOrPath, content);
            if (renamedFrom) {
                await this.handleRename(fileOrPath, renamedFrom, content);
                return 'done';
            }
        }

        const remote = await this.gitService.getFile(repoPath, this.settings.branch);

        // Don't convert a remote symlink into a regular file.
        if (remote.isSymlink) return 'unchanged';

        // Skip if already in sync
        if (remote.sha && this.contentsEqual(content, remote.content)) {
            await this.updateMetadata(path, remote.sha);
            return 'unchanged';
        }

        // Same conflict check as the single-file flow: if the remote has moved on
        // from what we last synced, overwriting it here would silently discard
        // whatever changed on the remote. Skip it instead of force-pushing so the
        // batch action can't quietly clobber changes the way a single push would
        // stop and ask about via SyncConflictModal.
        const lastSynced = this.settings.syncMetadata[path];
        if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
            return 'conflict';
        }

        await this.performPush({ path, name }, content, remote.sha || undefined, true);
        return 'done';
    }

    private async processSingleBatchPull(fileOrPath: TFile | string, path: string, name: string, isString: boolean): Promise<BatchOutcome> {
        const repoPath = this.getNormalizedPath(path);
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
}
