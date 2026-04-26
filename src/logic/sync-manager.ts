import { TFile, App, Notice } from 'obsidian';
import { GitServiceInterface } from '../services/git-service-interface';
import { GitLabFilesPushSettings } from '../settings';
import { SyncConflictModal } from '../ui/SyncConflictModal';

export class SyncManager {
    private readonly app: App;
    private gitService: GitServiceInterface;
    private readonly settings: GitLabFilesPushSettings;

    constructor(app: App, gitService: GitServiceInterface, settings: GitLabFilesPushSettings) {
        this.app = app;
        this.gitService = gitService;
        this.settings = settings;
    }

    private get serviceName(): string {
        return this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
    }

    public async updateMetadata(path: string, sha: string): Promise<void> {
        this.settings.syncMetadata[path] = {
            lastSyncedSha: sha,
            lastSyncedAt: Date.now(),
            lastKnownPath: path
        };
        await this.saveSettings();
    }

    updateGitService(gitService: GitServiceInterface): void {
        this.gitService = gitService;
    }

    async pushFile(fileOrPath: TFile | string) {
        const { path, name, isString } = this.getFileInfo(fileOrPath);

        if (!await this.checkFileExists(path, isString)) {
            new Notice(`File ${name} no longer exists in vault.`);
            return;
        }

        const content = await this.getFileContent(fileOrPath);
        try {
            // Check if this is a renamed file
            let renamedFrom = null;
            if (!isString && fileOrPath instanceof TFile) {
                renamedFrom = this.detectRename(fileOrPath);
                if (renamedFrom) {
                    await this.handleRename(fileOrPath, renamedFrom, content);
                    return;
                }
            }

            // Conflict detection
            const remote = await this.gitService.getFile(path, this.settings.branch);
            const lastSynced = this.settings.syncMetadata[path];

            if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new SyncConflictModal(this.app, name, content, remote.content, (choice) => {
                    void (async () => {
                        try {
                            const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
                            if (choice === 'local') {
                                await this.performPush({ path, name }, content, remote.sha);
                            } else {
                                await this.performPull(fileRep, remote.content, remote.sha);
                            }
                        } catch (e) {
                            console.error(e);
                            new Notice(`Failed to resolve conflict for ${name}: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    })();
                }).open();
                return;
            }

            await this.performPush({ path, name }, content, remote.sha);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to push ${name} to ${this.serviceName}: ${e instanceof Error ? e.message : String(e)}`);
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

    private async handleRename(file: TFile, oldPath: string, content: string): Promise<void> {
        try {
            // Push the file to the new location
            await this.gitService.pushFile(
                file.path,
                content,
                this.settings.branch,
                `Rename ${oldPath} to ${file.path}`,
                undefined
            );

            // Delete the old file from remote
            // Note: GitLab and GitHub APIs handle this differently
            // For now, we'll just update metadata and let the user manually delete if needed

            // Update metadata
            const newRemote = await this.gitService.getFile(file.path, this.settings.branch);
            await this.updateMetadata(file.path, newRemote.sha);

            // Remove old metadata
            delete this.settings.syncMetadata[oldPath];

            await this.saveSettings();
            new Notice(`Renamed and pushed ${file.name} to ${this.serviceName}\nNote: Old file at ${oldPath} may need manual deletion from remote`);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to handle rename: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async performPush(file: {path: string, name: string}, content: string, existingSha?: string, silent = false) {
        await this.gitService.pushFile(
            file.path,
            content,
            this.settings.branch,
            `Update ${file.name} from Obsidian`,
            existingSha
        );

        // Update metadata
        const newRemote = await this.gitService.getFile(file.path, this.settings.branch);
        await this.updateMetadata(file.path, newRemote.sha);
        
        if (!silent) new Notice(`Pushed ${file.name} to ${this.serviceName}`);
    }

    async pullFile(fileOrPath: TFile | string) {
        const { path, name, isString } = this.getFileInfo(fileOrPath);

        try {
            const remote = await this.gitService.getFile(path, this.settings.branch);
            if (!remote.sha) {
                new Notice(`File ${name} not found on remote.`);
                return;
            }

            const exists = await this.checkFileExists(path, isString);
            const localContent = exists ? await this.getFileContent(fileOrPath) : null;
            const lastSynced = this.settings.syncMetadata[path];

            if (exists && localContent === remote.content) {
                // Still update metadata even if content matches
                await this.updateMetadata(path, remote.sha);
                new Notice(`${name} is already up to date.`);
                return;
            }

            // Conflict detection for pull (only if local exists)
            if (exists && remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new SyncConflictModal(this.app, name, localContent || '', remote.content, (choice) => {
                    void (async () => {
                        try {
                            const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
                            if (choice === 'local') {
                                await this.performPush({ path, name }, localContent || '', remote.sha);
                            } else {
                                await this.performPull(fileRep, remote.content, remote.sha);
                            }
                        } catch (e) {
                            console.error(e);
                            new Notice(`Failed to resolve conflict for ${name}: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    })();
                }).open();
                return;
            }

            const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
            await this.performPull(fileRep, remote.content, remote.sha);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to pull ${name} from ${this.serviceName}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async performPull(file: TFile | {path: string, name: string}, remoteContent: string, remoteSha: string, silent = false) {
        await this.ensureParentDirs(file.path);
        
        if (file instanceof TFile) {
            await this.app.vault.modify(file, remoteContent);
        } else {
            await this.app.vault.adapter.write(file.path, remoteContent);
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
            if (!this.app.vault.getAbstractFileByPath(cur)) {
                try {
                    await this.app.vault.createFolder(cur);
                } catch {
                    // already exists or failed
                }
            }
        }
    }

    private async saveSettings() {
        const plugins = (this.app as unknown as { plugins: { plugins: Record<string, { saveSettings: () => Promise<void> }> } }).plugins;
        const plugin = plugins?.plugins?.['git-file-sync'];
        if (plugin && typeof plugin.saveSettings === 'function') {
            await plugin.saveSettings();
        }
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
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const { path, name, isString } = this.getFileInfo(fileOrPath);

            if (onProgress) {
                onProgress(i + 1, files.length, name);
            }

            try {
                if (op === 'push') {
                    await this.processSingleBatchPush(fileOrPath, path, name, isString);
                } else {
                    await this.processSingleBatchPull(fileOrPath, path, name, isString);
                }
                results.success++;
            } catch (e) {
                console.error(`Failed to ${op} ${path}:`, e);
                results.failed++;
                results.errors.push({ file: path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        await this.saveSettings();
        if (results.success > 0) new Notice(`${op === 'push' ? 'Pushed' : 'Pulled'} ${results.success} file(s) to ${serviceName}`);
        if (results.failed > 0) new Notice(`Failed to ${op} ${results.failed} file(s). Check console for details.`);

        return results;
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

    private async getFileContent(fileOrPath: TFile | string): Promise<string> {
        if (typeof fileOrPath === 'string') {
            return await this.app.vault.adapter.read(fileOrPath);
        }
        return await this.app.vault.read(fileOrPath);
    }

    private async processSingleBatchPush(fileOrPath: TFile | string, path: string, name: string, isString: boolean) {
        if (!await this.checkFileExists(path, isString)) throw new Error('File no longer exists');
        const content = await this.getFileContent(fileOrPath);

        // Rename detection
        if (!isString && fileOrPath instanceof TFile) {
            const renamedFrom = this.detectRename(fileOrPath);
            if (renamedFrom) {
                await this.handleRename(fileOrPath, renamedFrom, content);
                return;
            }
        }

        const remote = await this.gitService.getFile(path, this.settings.branch);
        await this.performPush({ path, name }, content, remote.sha || undefined, true);
    }

    private async processSingleBatchPull(fileOrPath: TFile | string, path: string, name: string, isString: boolean) {
        const remote = await this.gitService.getFile(path, this.settings.branch);
        if (!remote.sha) throw new Error('File not found in remote');

        const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
        await this.performPull(fileRep, remote.content, remote.sha, true);
    }
}
