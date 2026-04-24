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

    async pushFile(file: TFile) {
        if (!this.app.vault.getFileByPath(file.path)) {
            new Notice(`File ${file.name} no longer exists in vault.`);
            return;
        }
        const content = await this.app.vault.read(file);
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        try {
            // Check if this is a renamed file
            const renamedFrom = this.detectRename(file);
            if (renamedFrom) {
                await this.handleRename(file, renamedFrom, content);
                return;
            }

            // Conflict detection
            const remote = await this.gitService.getFile(file.path, this.settings.branch);
            const lastSynced = this.settings.syncMetadata[file.path];

            if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new SyncConflictModal(this.app, file, content, remote.content, (choice) => {
                    void (async () => {
                        try {
                            if (choice === 'local') {
                                await this.performPush(file, content, remote.sha);
                            } else {
                                await this.performPull(file, remote.content, remote.sha);
                            }
                        } catch (e) {
                            console.error(e);
                            new Notice(`Failed to resolve conflict for ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    })();
                }).open();
                return;
            }

            await this.performPush(file, content, remote.sha);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to push ${file.name} to ${serviceName}: ${e instanceof Error ? e.message : String(e)}`);
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

    private async performPush(file: TFile, content: string, existingSha?: string) {
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

    async pullFile(file: TFile) {
        if (!this.app.vault.getFileByPath(file.path)) {
            new Notice(`File ${file.name} no longer exists in vault.`);
            return;
        }
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        try {
            const remote = await this.gitService.getFile(file.path, this.settings.branch);
            const localContent = await this.app.vault.read(file);
            const lastSynced = this.settings.syncMetadata[file.path];

            if (localContent === remote.content) {
                // Still update metadata even if content matches
                this.settings.syncMetadata[file.path] = {
                    lastSyncedSha: remote.sha,
                    lastSyncedAt: Date.now()
                };
                await this.saveSettings();
                new Notice(`${file.name} is already up to date.`);
                return;
            }

            // Conflict detection for pull
            if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new SyncConflictModal(this.app, file, localContent, remote.content, (choice) => {
                    void (async () => {
                        try {
                            if (choice === 'local') {
                                await this.performPush(file, localContent, remote.sha);
                            } else {
                                await this.performPull(file, remote.content, remote.sha);
                            }
                        } catch (e) {
                            console.error(e);
                            new Notice(`Failed to resolve conflict for ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    })();
                }).open();
                return;
            }

            await this.performPull(file, remote.content, remote.sha);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to pull ${file.name} from ${serviceName}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async performPull(file: TFile, remoteContent: string, remoteSha: string) {
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        await this.app.vault.modify(file, remoteContent);

        // Update metadata
        this.settings.syncMetadata[file.path] = {
            lastSyncedSha: remoteSha,
            lastSyncedAt: Date.now(),
            lastKnownPath: file.path
        };

        await this.saveSettings();
        new Notice(`Pulled ${file.name} from ${serviceName}`);
    }

    private async saveSettings() {
        /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
        // @ts-ignore - access private method to save settings
        const plugin = (this.app as any).plugins?.plugins?.['git-file-push'];
        if (plugin) {
            await plugin.saveSettings();
        }
        /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
    }

    async pushAllFiles(files: TFile[], onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ success: number; failed: number; errors: Array<{ file: string; error: string }> }> {
        const results = { success: 0, failed: 0, errors: [] as Array<{ file: string; error: string }> };
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file) continue;

            if (onProgress) {
                onProgress(i + 1, files.length, file.name);
            }

            try {
                const existingFile = this.app.vault.getFileByPath(file.path);
                if (!existingFile) {
                    results.failed++;
                    results.errors.push({ file: file.path, error: 'File no longer exists' });
                    continue;
                }

                const content = await this.app.vault.read(existingFile);
                const remote = await this.gitService.getFile(file.path, this.settings.branch);

                await this.gitService.pushFile(
                    file.path,
                    content,
                    this.settings.branch,
                    `Update ${file.name} from Obsidian`,
                    remote.sha || undefined
                );

                const newRemote = await this.gitService.getFile(file.path, this.settings.branch);
                this.settings.syncMetadata[file.path] = {
                    lastSyncedSha: newRemote.sha,
                    lastSyncedAt: Date.now(),
                    lastKnownPath: file.path
                };

                results.success++;
            } catch (e) {
                console.error(`Failed to push ${file.path}:`, e);
                results.failed++;
                results.errors.push({
                    file: file.path,
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

    async pullAllFiles(files: TFile[], onProgress?: (current: number, total: number, fileName: string) => void): Promise<{ success: number; failed: number; errors: Array<{ file: string; error: string }> }> {
        const results = { success: 0, failed: 0, errors: [] as Array<{ file: string; error: string }> };
        const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file) continue;

            if (onProgress) {
                onProgress(i + 1, files.length, file.name);
            }

            try {
                const existingFile = this.app.vault.getFileByPath(file.path);
                if (!existingFile) {
                    results.failed++;
                    results.errors.push({ file: file.path, error: 'File no longer exists' });
                    continue;
                }

                const remote = await this.gitService.getFile(file.path, this.settings.branch);

                if (!remote.sha) {
                    results.failed++;
                    results.errors.push({ file: file.path, error: 'File not found in remote' });
                    continue;
                }

                await this.app.vault.modify(existingFile, remote.content);

                this.settings.syncMetadata[file.path] = {
                    lastSyncedSha: remote.sha,
                    lastSyncedAt: Date.now(),
                    lastKnownPath: file.path
                };

                results.success++;
            } catch (e) {
                console.error(`Failed to pull ${file.path}:`, e);
                results.failed++;
                results.errors.push({
                    file: file.path,
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
