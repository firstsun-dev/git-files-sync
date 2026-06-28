import { TFile, App, Notice } from 'obsidian';
import { GitServiceInterface } from '../services/git-service-interface';
import { GitLabFilesPushSettings, getServiceName } from '../settings';
import { SyncConflictModal } from '../ui/SyncConflictModal';
import { logger } from '../utils/logger';
import { isBinaryPath, contentsEqual } from '../utils/path';

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

        const content = await this.getFileContent(fileOrPath);
        try {
            // Check if this is a renamed file
            if (!isString && fileOrPath instanceof TFile) {
                const renamedFrom = this.detectRename(fileOrPath);
                if (renamedFrom) {
                    await this.handleRename(fileOrPath, renamedFrom, content);
                    return;
                }
            }

            // Conflict detection & equality check
            const remote = await this.gitService.getFile(repoPath, this.settings.branch);
            
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
                                await this.performPull(fileRep, remote.content, remote.sha);
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

    private detectRename(file: TFile): string | null {
        // Check if there's a metadata entry with the same SHA but different path
        const metadataEntries = Object.keys(this.settings.syncMetadata);
        for (const oldPath of metadataEntries) {
            const metadata = this.settings.syncMetadata[oldPath];
            if (!metadata) continue;

            if (oldPath !== file.path && metadata.lastKnownPath === oldPath) {
                // Check if the old file no longer exists
                if (!this.app.vault.getFileByPath(oldPath)) {
                    // This might be a rename
                    return oldPath;
                }
            }
        }
        return null;
    }

    private async handleRename(file: TFile, oldPath: string, content: string | ArrayBuffer): Promise<void> {
        try {
            const repoPath = this.getNormalizedPath(file.path);
            const oldRepoPath = this.getNormalizedPath(oldPath);

            // Push the file to the new location
            const result = await this.gitService.pushFile(
                repoPath,
                content,
                this.settings.branch,
                `Rename ${oldRepoPath} to ${repoPath}`,
                undefined
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
                                await this.performPull(fileRep, remote.content, remote.sha);
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

    private async performPull(file: TFile | {path: string, name: string}, remoteContent: string | ArrayBuffer, remoteSha: string, silent = false) {
        await this.ensureParentDirs(file.path);

        if (typeof remoteContent !== 'string') {
            // remoteContent is ArrayBuffer
            if (file instanceof TFile) {
                await this.app.vault.modifyBinary(file, remoteContent);
            } else {
                await this.app.vault.adapter.writeBinary(file.path, remoteContent);
            }
        } else {
            // remoteContent is string
            if (file instanceof TFile) {
                await this.app.vault.modify(file, remoteContent);
            } else {
                await this.app.vault.adapter.write(file.path, remoteContent);
            }
        }

        // Update metadata
        await this.updateMetadata(file.path, remoteSha);

        if (!silent) new Notice(`Pulled ${file.name} from ${this.serviceName}`);
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

    async pushAllFiles(files: (TFile | string)[], onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ success: number; failed: number; errors: Array<{ file: string; error: string }> }> {
        return this.processBatch(files, 'push', onProgress);
    }

    async pullAllFiles(files: (TFile | string)[], onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ success: number; failed: number; errors: Array<{ file: string; error: string }> }> {
        return this.processBatch(files, 'pull', onProgress);
    }

    private async processBatch(
        files: (TFile | string)[],
        op: 'push' | 'pull',
        onProgress?: (current: number, total: number, fileName: string) => void
    ): Promise<{ success: number; failed: number; errors: Array<{ file: string; error: string }> }> {
        const results = { success: 0, failed: 0, errors: [] as Array<{ file: string; error: string }> };

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const { path, name, isString } = this.getFileInfo(fileOrPath);
            onProgress?.(i + 1, files.length, name);

            try {
                let performed = false;
                if (op === 'push') {
                    performed = await this.processSingleBatchPush(fileOrPath, path, name, isString);
                } else {
                    performed = await this.processSingleBatchPull(fileOrPath, path, name, isString);
                }
                if (performed) results.success++;
            } catch (e) {
                logger.error(`Failed to ${op} ${path}:`, e);
                results.failed++;
                results.errors.push({ file: path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        await this.saveSettings();
        this.notifyBatchResult(op, results.success, results.failed);

        return results;
    }

    private notifyBatchResult(op: 'push' | 'pull', success: number, failed: number): void {
        const opName = op === 'push' ? 'Pushed' : 'Pulled';
        if (success > 0) {
            new Notice(`${opName} ${success} file(s) to ${this.serviceName}`);
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

    private async processSingleBatchPush(fileOrPath: TFile | string, path: string, name: string, isString: boolean): Promise<boolean> {
        if (!await this.checkFileExists(path, isString)) throw new Error('File no longer exists');
        const content = await this.getFileContent(fileOrPath);
        const repoPath = this.getNormalizedPath(path);

        // Rename detection
        if (!isString && fileOrPath instanceof TFile) {
            const renamedFrom = this.detectRename(fileOrPath);
            if (renamedFrom) {
                await this.handleRename(fileOrPath, renamedFrom, content);
                return true;
            }
        }

        const remote = await this.gitService.getFile(repoPath, this.settings.branch);
        
        // Skip if already in sync
        if (remote.sha && this.contentsEqual(content, remote.content)) {
            await this.updateMetadata(path, remote.sha);
            return false;
        }

        await this.performPush({ path, name }, content, remote.sha || undefined, true);
        return true;
    }

    private async processSingleBatchPull(fileOrPath: TFile | string, path: string, name: string, isString: boolean): Promise<boolean> {
        const repoPath = this.getNormalizedPath(path);
        const remote = await this.gitService.getFile(repoPath, this.settings.branch);
        if (!remote.sha) throw new Error('File not found in remote');

        const exists = await this.checkFileExists(path, isString);
        if (exists) {
            const localContent = await this.getFileContent(fileOrPath);
            if (this.contentsEqual(localContent, remote.content)) {
                await this.updateMetadata(path, remote.sha);
                return false;
            }
        }

        const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
        await this.performPull(fileRep, remote.content, remote.sha, true);
        return true;
    }
}
