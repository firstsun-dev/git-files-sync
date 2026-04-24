import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import GitLabFilesPush from '../main';

export const SYNC_STATUS_VIEW_TYPE = 'sync-status-view';

interface FileStatus {
    file: TFile;
    status: 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'checking';
    localContent?: string;
    remoteContent?: string;
    remoteSha?: string;
    diff?: string;
}

export class SyncStatusView extends ItemView {
    plugin: GitLabFilesPush;
    private fileStatuses: Map<string, FileStatus> = new Map();
    private isRefreshing = false;

    constructor(leaf: WorkspaceLeaf, plugin: GitLabFilesPush) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return SYNC_STATUS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Sync status';
    }

    getIcon(): string {
        return 'git-compare';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        if (!container) return;
        container.empty();
        container.addClass('sync-status-view');

        this.renderView();
    }

    private renderView(): void {
        const container = this.containerEl.children[1];
        if (!container) return;
        container.empty();

        const headerEl = container.createDiv({ cls: 'sync-status-header' });
        headerEl.createEl('h4', { text: 'Repository sync status' });

        const serviceName = this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        const serviceInfo = container.createDiv({ cls: 'sync-status-info' });
        serviceInfo.createEl('div', { text: `Service: ${serviceName}` });
        serviceInfo.createEl('div', { text: `Branch: ${this.plugin.settings.branch}` });
        if (this.plugin.settings.vaultFolder) {
            serviceInfo.createEl('div', { text: `Vault Folder: ${this.plugin.settings.vaultFolder}` });
        }

        const buttonContainer = container.createDiv({ cls: 'sync-status-buttons' });
        const refreshBtn = buttonContainer.createEl('button', { text: 'Refresh status' });
        refreshBtn.addEventListener('click', () => {
            void this.refreshAllStatuses();
        });

        const pushAllBtn = buttonContainer.createEl('button', { text: 'Push all modified', cls: 'push-all-btn' });
        pushAllBtn.addEventListener('click', () => {
            void this.pushAllModified();
        });

        const pullAllBtn = buttonContainer.createEl('button', { text: 'Pull all modified', cls: 'pull-all-btn' });
        pullAllBtn.addEventListener('click', () => {
            void this.pullAllModified();
        });

        const statusContainer = container.createDiv({ cls: 'sync-status-list' });

        if (this.fileStatuses.size === 0) {
            statusContainer.createEl('div', {
                text: 'Click "Refresh status" to check all files',
                cls: 'sync-status-empty'
            });
        } else {
            this.renderFileStatuses(statusContainer);
        }
    }

    private renderFileStatuses(container: HTMLElement): void {
        const statuses = Array.from(this.fileStatuses.values());

        const summary = container.createDiv({ cls: 'sync-status-summary' });
        const synced = statuses.filter(s => s.status === 'synced').length;
        const modified = statuses.filter(s => s.status === 'modified').length;
        const unsynced = statuses.filter(s => s.status === 'unsynced').length;

        summary.createEl('div', { text: `✓ Synced: ${synced}` });
        summary.createEl('div', { text: `⚠ Modified: ${modified}` });
        summary.createEl('div', { text: `✗ Unsynced: ${unsynced}` });

        for (const fileStatus of statuses) {
            this.renderFileStatus(container, fileStatus);
        }
    }

    private renderFileStatus(container: HTMLElement, fileStatus: FileStatus): void {
        const fileEl = container.createDiv({ cls: 'sync-status-file' });

        const headerEl = fileEl.createDiv({ cls: 'sync-status-file-header' });

        let icon = '○';
        let statusText = '';
        let statusClass = '';

        switch (fileStatus.status) {
            case 'synced':
                icon = '✓';
                statusText = 'Synced';
                statusClass = 'status-synced';
                break;
            case 'modified':
                icon = '⚠';
                statusText = 'Modified';
                statusClass = 'status-modified';
                break;
            case 'unsynced':
                icon = '✗';
                statusText = 'Not in remote';
                statusClass = 'status-unsynced';
                break;
            case 'checking':
                icon = '⟳';
                statusText = 'Checking...';
                statusClass = 'status-checking';
                break;
        }

        headerEl.createSpan({ text: `${icon} `, cls: `status-icon ${statusClass}` });
        headerEl.createSpan({ text: fileStatus.file.path, cls: 'file-path' });
        headerEl.createSpan({ text: ` (${statusText})`, cls: `status-text ${statusClass}` });

        if (fileStatus.status === 'modified' && fileStatus.diff) {
            const diffToggle = headerEl.createEl('button', {
                text: 'Show diff',
                cls: 'diff-toggle'
            });

            const diffContainer = fileEl.createDiv({ cls: 'sync-status-diff' });
            diffContainer.addClass('hidden');

            const diffPre = diffContainer.createEl('pre');
            diffPre.createEl('code', { text: fileStatus.diff });

            diffToggle.addEventListener('click', () => {
                if (diffContainer.hasClass('hidden')) {
                    diffContainer.removeClass('hidden');
                    diffToggle.setText('Hide diff');
                } else {
                    diffContainer.addClass('hidden');
                    diffToggle.setText('Show diff');
                }
            });

            const actionsEl = fileEl.createDiv({ cls: 'sync-status-actions' });
            const pushBtn = actionsEl.createEl('button', { text: 'Push' });
            const pullBtn = actionsEl.createEl('button', { text: 'Pull' });

            pushBtn.addEventListener('click', () => {
                void this.plugin.sync.pushFile(fileStatus.file);
                setTimeout(() => void this.refreshFileStatus(fileStatus.file), 1000);
            });

            pullBtn.addEventListener('click', () => {
                void this.plugin.sync.pullFile(fileStatus.file);
                setTimeout(() => void this.refreshFileStatus(fileStatus.file), 1000);
            });
        }
    }

    async refreshAllStatuses(): Promise<void> {
        if (this.isRefreshing) {
            new Notice('Already refreshing...');
            return;
        }

        this.isRefreshing = true;
        this.fileStatuses.clear();

        const container = this.containerEl.children[1];
        if (container) {
            const statusContainer = container.querySelector('.sync-status-list') as HTMLElement;
            if (statusContainer) {
                statusContainer.empty();
                statusContainer.createEl('div', { text: 'Checking files...', cls: 'sync-status-loading' });
            }
        }

        try {
            const allFiles = this.app.vault.getMarkdownFiles();
            const files = this.plugin.filterFilesByVaultFolder(allFiles);

            for (const file of files) {
                this.fileStatuses.set(file.path, {
                    file,
                    status: 'checking'
                });
            }

            this.renderView();

            for (const file of files) {
                await this.refreshFileStatus(file);
            }

            this.renderView();
            new Notice(`Checked ${files.length} files`);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to refresh: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.isRefreshing = false;
        }
    }

    private async refreshFileStatus(file: TFile): Promise<void> {
        try {
            const localContent = await this.app.vault.read(file);
            const remote = await this.plugin.gitService.getFile(file.path, this.plugin.settings.branch);

            let status: FileStatus['status'];
            let diff: string | undefined;

            if (!remote.sha) {
                status = 'unsynced';
            } else if (localContent === remote.content) {
                status = 'synced';
            } else {
                status = 'modified';
                diff = this.generateDiff(remote.content, localContent);
            }

            this.fileStatuses.set(file.path, {
                file,
                status,
                localContent,
                remoteContent: remote.content,
                remoteSha: remote.sha,
                diff
            });

        } catch (e) {
            console.error(`Error checking ${file.path}:`, e);
            this.fileStatuses.set(file.path, {
                file,
                status: 'unsynced'
            });
        }
    }

    private generateDiff(oldContent: string, newContent: string): string {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');

        const diff: string[] = [];
        diff.push('--- Remote');
        diff.push('+++ Local');
        diff.push('');

        const maxLines = Math.max(oldLines.length, newLines.length);

        for (let i = 0; i < maxLines; i++) {
            const oldLine = oldLines[i];
            const newLine = newLines[i];

            if (oldLine !== newLine) {
                if (oldLine !== undefined) {
                    diff.push(`- ${oldLine}`);
                }
                if (newLine !== undefined) {
                    diff.push(`+ ${newLine}`);
                }
            }
        }

        return diff.join('\n');
    }

    async pushAllModified(): Promise<void> {
        const modifiedFiles = Array.from(this.fileStatuses.values())
            .filter(s => s.status === 'modified' || s.status === 'unsynced')
            .map(s => s.file);

        if (modifiedFiles.length === 0) {
            new Notice('No modified files to push');
            return;
        }

        const serviceName = this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        const confirmed = await this.showConfirmDialog(`Push ${modifiedFiles.length} file(s) to ${serviceName}?`);
        if (!confirmed) return;

        const progressNotice = new Notice(`Pushing 0/${modifiedFiles.length} files...`, 0);

        try {
            const results = await this.plugin.sync.pushAllFiles(modifiedFiles, (current, total, fileName) => {
                progressNotice.setMessage(`Pushing ${current}/${total}: ${fileName}`);
            });

            progressNotice.hide();

            if (results.errors.length > 0) {
                console.error('Push errors:', results.errors);
            }

            await this.refreshAllStatuses();
        } catch (e) {
            progressNotice.hide();
            console.error(e);
            new Notice(`Push failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async pullAllModified(): Promise<void> {
        const modifiedFiles = Array.from(this.fileStatuses.values())
            .filter(s => s.status === 'modified')
            .map(s => s.file);

        if (modifiedFiles.length === 0) {
            new Notice('No modified files to pull');
            return;
        }

        const serviceName = this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        const confirmed = await this.showConfirmDialog(`Pull ${modifiedFiles.length} file(s) from ${serviceName}? This will overwrite local changes.`);
        if (!confirmed) return;

        const progressNotice = new Notice(`Pulling 0/${modifiedFiles.length} files...`, 0);

        try {
            const results = await this.plugin.sync.pullAllFiles(modifiedFiles, (current, total, fileName) => {
                progressNotice.setMessage(`Pulling ${current}/${total}: ${fileName}`);
            });

            progressNotice.hide();

            if (results.errors.length > 0) {
                console.error('Pull errors:', results.errors);
            }

            await this.refreshAllStatuses();
        } catch (e) {
            progressNotice.hide();
            console.error(e);
            new Notice(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async onClose(): Promise<void> {
        // Cleanup
    }

    private showConfirmDialog(message: string): Promise<boolean> {
        return new Promise((resolve) => {
            // eslint-disable-next-line no-alert
            const confirmed = confirm(message);
            resolve(confirmed);
        });
    }
}
