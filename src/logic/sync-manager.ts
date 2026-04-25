import { TFile, App, Notice } from 'obsidian';
import { GitServiceInterface } from '../services/git-service-interface';
import { GitLabFilesPushSettings, SyncMetadata } from '../settings';
import { SyncConflictModal } from '../ui/SyncConflictModal';

export class SyncManager {
    private app: App;
    private gitService: GitServiceInterface;
    private settings: GitLabFilesPushSettings;
    private metadata: Record<string, SyncMetadata> = {};

    constructor(app: App, gitService: GitServiceInterface, settings: GitLabFilesPushSettings) {
        this.app = app;
        this.gitService = gitService;
        this.settings = settings;
    }

    updateGitService(gitService: GitServiceInterface): void {
        this.gitService = gitService;
    }

    async pushFile(fileOrPath: TFile | string) {
        const isString = typeof fileOrPath === 'string';
        const path = isString ? fileOrPath : fileOrPath.path;
        const name = isString ? path.split('/').pop() || path : fileOrPath.name;

        if (isString) {
            if (!(await this.app.vault.adapter.exists(path))) {
                new Notice(`File ${name} no longer exists in vault.`);
                return;
            }
        } else if (!this.app.vault.getFileByPath(path)) {
            new Notice(`File ${name} no longer exists in vault.`);
            return;
        }

        const content = isString ? await this.app.vault.adapter.read(path) : (fileOrPath instanceof TFile ? await this.app.vault.read(fileOrPath) : '');
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
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
                            if (choice === 'local') {
                                await this.performPush({ path, name }, content, remote.sha);
                            } else {
                                await this.performPull(isString ? { path, name } : fileOrPath, remote.content, remote.sha);
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
            new Notice(`Failed to push ${name} to ${serviceName}: ${e instanceof Error ? e.message : String(e)}`);
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
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

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
            this.settings.syncMetadata[file.path] = {
                lastSyncedSha: newRemote.sha,
                lastSyncedAt: Date.now(),
                lastKnownPath: file.path
            };

            // Remove old metadata
            delete this.settings.syncMetadata[oldPath];

            await this.saveSettings();
            new Notice(`Renamed and pushed ${file.name} to ${serviceName}\nNote: Old file at ${oldPath} may need manual deletion from remote`);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to handle rename: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async performPush(file: {path: string, name: string}, content: string, existingSha?: string) {
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        await this.gitService.pushFile(
            file.path,
            content,
            this.settings.branch,
            `Update ${file.name} from Obsidian`,
            existingSha
        );

        // Update metadata
        const newRemote = await this.gitService.getFile(file.path, this.settings.branch);
        this.settings.syncMetadata[file.path] = {
            lastSyncedSha: newRemote.sha,
            lastSyncedAt: Date.now(),
            lastKnownPath: file.path
        };

        await this.saveSettings();
        new Notice(`Pushed ${file.name} to ${serviceName}`);
    }

    async pullFile(fileOrPath: TFile | string) {
        const isString = typeof fileOrPath === 'string';
        const path = isString ? fileOrPath : fileOrPath.path;
        const name = isString ? path.split('/').pop() || path : fileOrPath.name;

        if (isString) {
            if (!(await this.app.vault.adapter.exists(path))) {
                new Notice(`File ${name} no longer exists in vault.`);
                return;
            }
        } else if (!this.app.vault.getFileByPath(path)) {
            new Notice(`File ${name} no longer exists in vault.`);
            return;
        }

        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        try {
            const remote = await this.gitService.getFile(path, this.settings.branch);
            const localContent = isString ? await this.app.vault.adapter.read(path) : (fileOrPath instanceof TFile ? await this.app.vault.read(fileOrPath) : '');
            const lastSynced = this.settings.syncMetadata[path];

            if (localContent === remote.content) {
                // Still update metadata even if content matches
                this.settings.syncMetadata[path] = {
                    lastSyncedSha: remote.sha,
                    lastSyncedAt: Date.now()
                };
                await this.saveSettings();
                new Notice(`${name} is already up to date.`);
                return;
            }

            // Conflict detection for pull
            if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new SyncConflictModal(this.app, name, localContent, remote.content, (choice) => {
                    void (async () => {
                        try {
                            if (choice === 'local') {
                                await this.performPush({ path, name }, localContent, remote.sha);
                            } else {
                                await this.performPull(isString ? { path, name } : fileOrPath, remote.content, remote.sha);
                            }
                        } catch (e) {
                            console.error(e);
                            new Notice(`Failed to resolve conflict for ${name}: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    })();
                }).open();
                return;
            }

            await this.performPull(isString ? { path, name } : fileOrPath, remote.content, remote.sha);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to pull ${name} from ${serviceName}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async performPull(file: TFile | {path: string, name: string}, remoteContent: string, remoteSha: string) {
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        
        if (file instanceof TFile) {
            await this.app.vault.modify(file, remoteContent);
        } else {
            await this.app.vault.adapter.write(file.path, remoteContent);
        }

        // Update metadata
        this.settings.syncMetadata[file.path] = {
            lastSyncedSha: remoteSha,
            lastSyncedAt: Date.now(),
            lastKnownPath: file.path
        };

        await this.saveSettings();
        const name = file instanceof TFile ? file.name : file.name;
        new Notice(`Pulled ${name} from ${serviceName}`);
    }

    private async saveSettings() {
        const plugins = (this.app as unknown as { plugins: { plugins: Record<string, { saveSettings: () => Promise<void> }> } }).plugins;
        const plugin = plugins?.plugins?.['git-file-sync'];
        if (plugin && typeof plugin.saveSettings === 'function') {
            await plugin.saveSettings();
        }
    }

    async pushAllFiles(files: (TFile | string)[], onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ success: number; failed: number; errors: Array<{ file: string; error: string }> }> {
        const results = { success: 0, failed: 0, errors: [] as Array<{ file: string; error: string }> };
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const isString = typeof fileOrPath === 'string';
            const path = isString ? fileOrPath : fileOrPath.path;
            const name = isString ? path.split('/').pop() || path : fileOrPath.name;

            if (onProgress) {
                onProgress(i + 1, files.length, name);
            }

            try {
                let content: string;
                if (isString) {
                    if (!(await this.app.vault.adapter.exists(path))) {
                        results.failed++;
                        results.errors.push({ file: path, error: 'File no longer exists' });
                        continue;
                    }
                    content = await this.app.vault.adapter.read(path);
                } else {
                    const existingFile = this.app.vault.getFileByPath(path);
                    if (!existingFile) {
                        results.failed++;
                        results.errors.push({ file: path, error: 'File no longer exists' });
                        continue;
                    }
                    content = await this.app.vault.read(existingFile);
                }

                const remote = await this.gitService.getFile(path, this.settings.branch);

                await this.gitService.pushFile(
                    path,
                    content,
                    this.settings.branch,
                    `Update ${name} from Obsidian`,
                    remote.sha || undefined
                );

                const newRemote = await this.gitService.getFile(path, this.settings.branch);
                this.settings.syncMetadata[path] = {
                    lastSyncedSha: newRemote.sha,
                    lastSyncedAt: Date.now(),
                    lastKnownPath: path
                };

                results.success++;
            } catch (e) {
                console.error(`Failed to push ${path}:`, e);
                results.failed++;
                results.errors.push({
                    file: path,
                    error: e instanceof Error ? e.message : String(e)
                });
            }
        }

        await this.saveSettings();

        if (results.success > 0) {
            new Notice(`Pushed ${results.success} file(s) to ${serviceName}`);
        }
        if (results.failed > 0) {
            new Notice(`Failed to push ${results.failed} file(s). Check console for details.`);
        }

        return results;
    }

    async pullAllFiles(files: (TFile | string)[], onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ success: number; failed: number; errors: Array<{ file: string; error: string }> }> {
        const results = { success: 0, failed: 0, errors: [] as Array<{ file: string; error: string }> };
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const isString = typeof fileOrPath === 'string';
            const path = isString ? fileOrPath : fileOrPath.path;
            const name = isString ? path.split('/').pop() || path : fileOrPath.name;

            if (onProgress) {
                onProgress(i + 1, files.length, name);
            }

            try {
                if (isString) {
                    if (!(await this.app.vault.adapter.exists(path))) {
                        results.failed++;
                        results.errors.push({ file: path, error: 'File no longer exists' });
                        continue;
                    }
                } else {
                    const existingFile = this.app.vault.getFileByPath(path);
                    if (!existingFile) {
                        results.failed++;
                        results.errors.push({ file: path, error: 'File no longer exists' });
                        continue;
                    }
                }

                const remote = await this.gitService.getFile(path, this.settings.branch);

                if (!remote.sha) {
                    results.failed++;
                    results.errors.push({ file: path, error: 'File not found in remote' });
                    continue;
                }

                if (isString) {
                    await this.app.vault.adapter.write(path, remote.content);
                } else if (fileOrPath instanceof TFile) {
                    await this.app.vault.modify(fileOrPath, remote.content);
                }

                this.settings.syncMetadata[path] = {
                    lastSyncedSha: remote.sha,
                    lastSyncedAt: Date.now(),
                    lastKnownPath: path
                };

                results.success++;
            } catch (e) {
                console.error(`Failed to pull ${path}:`, e);
                results.failed++;
                results.errors.push({
                    file: path,
                    error: e instanceof Error ? e.message : String(e)
                });
            }
        }

        await this.saveSettings();

        if (results.success > 0) {
            new Notice(`Pulled ${results.success} file(s) from ${serviceName}`);
        }
        if (results.failed > 0) {
            new Notice(`Failed to pull ${results.failed} file(s). Check console for details.`);
        }

        return results;
    }
}
