import { TFile, App, Notice } from 'obsidian';
import { GitLabService } from '../services/gitlab-service';
import { GitLabFilesPushSettings, SyncMetadata } from '../settings';

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
        const content = await this.app.vault.read(file);
        try {
            // Conflict detection
            const remote = await this.gitlab.getFile(file.path, this.settings.branch);
            const lastSynced = this.settings.syncMetadata[file.path];

            if (remote.sha && lastSynced && remote.sha !== lastSynced.lastSyncedSha) {
                new Notice(`Conflict detected for ${file.name}. Remote has changes. Please pull first.`);
                return;
            }

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

            /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
            // @ts-ignore - access private method to save settings
            const plugin = (this.app as any).plugins?.plugins?.['gitlab-files-push'];
            if (plugin) {
                await plugin.saveSettings();
            }
            /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */

            new Notice(`Pushed ${file.name} to GitLab`);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to push ${file.name}`);
        }
    }

    async pullFile(file: TFile) {
        try {
            const remote = await this.gitlab.getFile(file.path, this.settings.branch);
            const localContent = await this.app.vault.read(file);

            if (localContent === remote.content) {
                // Still update metadata even if content matches
                this.settings.syncMetadata[file.path] = {
                    lastSyncedSha: remote.sha,
                    lastSyncedAt: Date.now()
                };
                new Notice(`${file.name} is already up to date.`);
                return;
            }

            // For now, simple overwrite. Conflict UI will be added in Phase 4.
            await this.app.vault.modify(file, remote.content);

            // Update metadata
            this.settings.syncMetadata[file.path] = {
                lastSyncedSha: remote.sha,
                lastSyncedAt: Date.now()
            };

            new Notice(`Pulled ${file.name} from GitLab`);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to pull ${file.name}`);
        }
    }
}
