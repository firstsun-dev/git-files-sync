import { TFile, App, Notice } from 'obsidian';
import { GitLabService } from '../services/gitlab-service';
import { GitLabFilesPushSettings, SyncMetadata } from '../settings';
import { SyncConflictModal } from '../ui/SyncConflictModal';

export class SyncManager {
    private app: App;
    private gitlab: GitLabService;
    private settings: GitLabFilesPushSettings;
    private metadata: Record<string, SyncMetadata> = {};

    constructor(app: App, gitlab: GitLabService, settings: GitLabFilesPushSettings) {
        this.app = app;
        this.gitlab = gitlab;
        this.settings = settings;
    }

    async pushFile(file: TFile) {
        if (!this.app.vault.getFileByPath(file.path)) {
            new Notice(`File ${file.name} no longer exists in vault.`);
            return;
        }
        const content = await this.app.vault.read(file);
        try {
            // Conflict detection
            const remote = await this.gitlab.getFile(file.path, this.settings.branch);
            const lastSynced = this.settings.syncMetadata[file.path];

            if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new SyncConflictModal(this.app, file, content, remote.content, (choice) => {
                    void (async () => {
                        if (choice === 'local') {
                            await this.performPush(file, content);
                        } else {
                            await this.performPull(file, remote.content, remote.sha);
                        }
                    })();
                }).open();
                return;
            }

            await this.performPush(file, content);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to push ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async performPush(file: TFile, content: string) {
        await this.gitlab.pushFile(
            file.path,
            content,
            this.settings.branch,
            `Update ${file.name} from Obsidian`
        );

        // Update metadata
        const newRemote = await this.gitlab.getFile(file.path, this.settings.branch);
        this.settings.syncMetadata[file.path] = {
            lastSyncedSha: newRemote.sha,
            lastSyncedAt: Date.now()
        };

        await this.saveSettings();
        new Notice(`Pushed ${file.name} to GitLab`);
    }

    async pullFile(file: TFile) {
        if (!this.app.vault.getFileByPath(file.path)) {
            new Notice(`File ${file.name} no longer exists in vault.`);
            return;
        }
        try {
            const remote = await this.gitlab.getFile(file.path, this.settings.branch);
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
            // If remote has changed since last sync AND local has also changed since last sync
            if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                // Check if local content is different from what we think was last synced
                // (This is a bit simplified as we don't store the last synced content, only the SHA)
                // In a real scenario, we might want more robust check, but for now we follow the plan.
                new SyncConflictModal(this.app, file, localContent, remote.content, (choice) => {
                    void (async () => {
                        if (choice === 'local') {
                            await this.performPush(file, localContent);
                        } else {
                            await this.performPull(file, remote.content, remote.sha);
                        }
                    })();
                }).open();
                return;
            }

            await this.performPull(file, remote.content, remote.sha);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to pull ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async performPull(file: TFile, remoteContent: string, remoteSha: string) {
        await this.app.vault.modify(file, remoteContent);

        // Update metadata
        this.settings.syncMetadata[file.path] = {
            lastSyncedSha: remoteSha,
            lastSyncedAt: Date.now()
        };

        await this.saveSettings();
        new Notice(`Pulled ${file.name} from GitLab`);
    }

    private async saveSettings() {
        /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
        // @ts-ignore - access private method to save settings
        const plugin = (this.app as any).plugins?.plugins?.['gitlab-files-push'];
        if (plugin) {
            await plugin.saveSettings();
        }
        /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
    }
}
