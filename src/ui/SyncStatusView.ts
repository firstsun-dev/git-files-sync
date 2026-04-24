import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import GitLabFilesPush from '../main';

export const SYNC_STATUS_VIEW_TYPE = 'sync-status-view';

interface FileStatus {
    file?: TFile;
    path: string;
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
    private statusFilter: 'all' | 'synced' | 'modified' | 'unsynced' | 'remote-only' = 'all';
    private selectedFiles: Set<string> = new Set();
    private lastSyncTime: number = 0;
    private previousFilter: typeof this.statusFilter = 'all';

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
        if (this.lastSyncTime > 0) {
            const lastSyncDate = new Date(this.lastSyncTime);
            const timeStr = lastSyncDate.toLocaleString();
            serviceInfo.createEl('div', { text: `Last sync: ${timeStr}` });
        }

        const buttonContainer = container.createDiv({ cls: 'sync-status-buttons' });

        // Refresh button
        const refreshBtn = buttonContainer.createEl('button', { text: 'Refresh status', cls: 'refresh-btn' });
        refreshBtn.addEventListener('click', () => {
            void this.refreshAllStatuses();
        });

        // Selection buttons container
        const selectionContainer = container.createDiv({ cls: 'sync-selection-buttons' });

        const selectAllBtn = selectionContainer.createEl('button', { text: 'Select all' });
        selectAllBtn.addEventListener('click', () => {
            const visibleStatuses = this.statusFilter === 'all'
                ? Array.from(this.fileStatuses.values())
                : Array.from(this.fileStatuses.values()).filter(s => s.status === this.statusFilter);

            for (const status of visibleStatuses) {
                this.selectedFiles.add(status.path);
            }
            this.renderView();
        });

        const deselectAllBtn = selectionContainer.createEl('button', { text: 'Deselect all' });
        deselectAllBtn.addEventListener('click', () => {
            this.selectedFiles.clear();
            this.renderView();
        });

        // Repository operation buttons container
        const repoContainer = container.createDiv({ cls: 'sync-repo-buttons' });

        // Calculate counts for each operation
        const selectedStatuses = Array.from(this.selectedFiles)
            .map(path => this.fileStatuses.get(path))
            .filter(s => s) as FileStatus[];

        const canPush = selectedStatuses.filter(s => s.file && (s.status === 'modified' || s.status === 'unsynced')).length;
        const canPull = selectedStatuses.filter(s => s.status === 'modified' || s.status === 'remote-only').length;
        const canDelete = selectedStatuses.filter(s => s.file || s.status === 'remote-only').length;

        const pushSelectedBtn = repoContainer.createEl('button', {
            text: `Push selected (${canPush})`,
            cls: 'push-all-btn'
        });
        pushSelectedBtn.disabled = canPush === 0;
        pushSelectedBtn.addEventListener('click', () => {
            void this.pushSelected();
        });

        const pullSelectedBtn = repoContainer.createEl('button', {
            text: `Pull selected (${canPull})`,
            cls: 'pull-all-btn'
        });
        pullSelectedBtn.disabled = canPull === 0;
        pullSelectedBtn.addEventListener('click', () => {
            void this.pullSelected();
        });

        const deleteSelectedBtn = repoContainer.createEl('button', {
            text: `Delete selected (${canDelete})`,
            cls: 'delete-btn'
        });
        deleteSelectedBtn.disabled = canDelete === 0;
        deleteSelectedBtn.addEventListener('click', () => {
            void this.deleteSelected();
        });

        // Filter buttons
        const filterContainer = container.createDiv({ cls: 'sync-status-filters' });
        filterContainer.createEl('span', { text: 'Show: ' });

        type FilterValue = 'all' | 'synced' | 'modified' | 'unsynced' | 'remote-only';
        const filters: Array<{ value: FilterValue; label: string }> = [
            { value: 'all', label: 'All' },
            { value: 'synced', label: 'Synced' },
            { value: 'modified', label: 'Modified' },
            { value: 'unsynced', label: 'Not in remote' },
            { value: 'remote-only', label: 'Remote only' }
        ];

        for (const filter of filters) {
            const btn = filterContainer.createEl('button', {
                text: filter.label,
                cls: this.statusFilter === filter.value ? 'filter-active' : ''
            });
            btn.addEventListener('click', () => {
                // Clear selections when switching filter
                if (this.statusFilter !== filter.value) {
                    this.selectedFiles.clear();
                }
                this.statusFilter = filter.value;
                this.renderView();
            });
        }

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
        const allStatuses = Array.from(this.fileStatuses.values());

        // Apply filter
        const statuses = this.statusFilter === 'all'
            ? allStatuses
            : allStatuses.filter(s => s.status === this.statusFilter);

        const summary = container.createDiv({ cls: 'sync-status-summary' });
        const synced = allStatuses.filter(s => s.status === 'synced').length;
        const modified = allStatuses.filter(s => s.status === 'modified').length;
        const unsynced = allStatuses.filter(s => s.status === 'unsynced').length;
        const remoteOnly = allStatuses.filter(s => s.status === 'remote-only').length;

        summary.createEl('div', { text: `✓ Synced: ${synced}` });
        summary.createEl('div', { text: `⚠ Modified: ${modified}` });
        summary.createEl('div', { text: `✗ Unsynced: ${unsynced}` });
        summary.createEl('div', { text: `↓ Remote only: ${remoteOnly}` });

        if (statuses.length === 0) {
            container.createEl('div', {
                text: this.statusFilter === 'all' ? 'No files found' : `No ${this.statusFilter} files`,
                cls: 'sync-status-empty'
            });
            return;
        }

        for (const fileStatus of statuses) {
            this.renderFileStatus(container, fileStatus);
        }
    }

    private renderFileStatus(container: HTMLElement, fileStatus: FileStatus): void {
        const fileEl = container.createDiv({ cls: 'sync-status-file' });

        const headerEl = fileEl.createDiv({ cls: 'sync-status-file-header' });

        // Add checkbox
        const checkbox = headerEl.createEl('input', { type: 'checkbox' });
        checkbox.checked = this.selectedFiles.has(fileStatus.path);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                this.selectedFiles.add(fileStatus.path);
            } else {
                this.selectedFiles.delete(fileStatus.path);
            }
            this.renderView();
        });

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
            case 'remote-only':
                icon = '↓';
                statusText = 'Remote only';
                statusClass = 'status-remote-only';
                break;
            case 'checking':
                icon = '⟳';
                statusText = 'Checking...';
                statusClass = 'status-checking';
                break;
        }

        headerEl.createSpan({ text: `${icon} `, cls: `status-icon ${statusClass}` });
        headerEl.createSpan({ text: fileStatus.path, cls: 'file-path' });
        headerEl.createSpan({ text: ` (${statusText})`, cls: `status-text ${statusClass}` });

        if (fileStatus.status === 'unsynced' && fileStatus.file) {
            const actionsEl = fileEl.createDiv({ cls: 'sync-status-actions' });
            const pushBtn = actionsEl.createEl('button', { text: 'Push to remote' });
            const removeBtn = actionsEl.createEl('button', { text: 'Remove local file', cls: 'remove-btn' });

            pushBtn.addEventListener('click', async () => {
                try {
                    // Mark as checking
                    fileStatus.status = 'checking';
                    this.renderView();

                    await this.plugin.sync.pushFile(fileStatus.file || fileStatus.path);

                    // Wait a bit for the remote to update
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await this.refreshFileStatus(fileStatus.file || fileStatus.path);
                    this.renderView();
                } catch (e) {
                    console.error(e);
                    new Notice(`Push failed: ${e instanceof Error ? e.message : String(e)}`);
                    // Refresh to show current state
                    await this.refreshFileStatus(fileStatus.file || fileStatus.path);
                    this.renderView();
                }
            });

            removeBtn.addEventListener('click', async () => {
                const confirmed = await this.showConfirmDialog(`Delete local file "${fileStatus.path}"?`);
                if (confirmed) {
                    try {
                        if (fileStatus.file) {
                            await this.app.vault.delete(fileStatus.file);
                        } else {
                            await this.app.vault.adapter.remove(fileStatus.path);
                        }
                        new Notice(`Deleted ${fileStatus.path}`);
                        this.fileStatuses.delete(fileStatus.path);
                        this.renderView();
                    } catch (e) {
                        console.error(e);
                        new Notice(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            });
        }

        if (fileStatus.status === 'remote-only') {
            const actionsEl = fileEl.createDiv({ cls: 'sync-status-actions' });
            const pullBtn = actionsEl.createEl('button', { text: 'Pull from remote' });

            pullBtn.addEventListener('click', async () => {
                try {
                    // Mark as checking
                    fileStatus.status = 'checking';
                    this.renderView();

                    console.log('Pulling remote-only file:', fileStatus.path);
                    const remote = await this.plugin.gitService.getFile(fileStatus.path, this.plugin.settings.branch);
                    console.log('Got remote file, content length:', remote.content.length, 'sha:', remote.sha);

                    if (remote.content) {
                        console.log('Creating file at path:', fileStatus.path);

                        // Ensure parent directories exist (recursively)
                        const pathParts = fileStatus.path.split('/');
                        if (pathParts.length > 1) {
                            let currentPath = '';
                            for (let i = 0; i < pathParts.length - 1; i++) {
                                currentPath += (i > 0 ? '/' : '') + pathParts[i];
                                const dir = this.app.vault.getAbstractFileByPath(currentPath);
                                if (!dir) {
                                    console.log('Creating directory:', currentPath);
                                    try {
                                        await this.app.vault.createFolder(currentPath);
                                    } catch (e) {
                                        // Folder might already exist, ignore error
                                        console.log('Folder creation error (might already exist):', e);
                                    }
                                }
                            }
                        }

                        await this.app.vault.create(fileStatus.path, remote.content);
                        console.log('File created successfully');

                        // Update sync metadata
                        this.plugin.settings.syncMetadata[fileStatus.path] = {
                            lastSyncedSha: remote.sha,
                            lastSyncedAt: Date.now(),
                            lastKnownPath: fileStatus.path
                        };
                        await this.plugin.saveSettings();
                        console.log('Metadata saved');

                        new Notice(`Pulled ${fileStatus.path}`);

                        // Wait for file to be created and vault to update
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        // Force refresh all statuses to pick up the new file
                        console.log('Refreshing all statuses after pull');
                        await this.refreshAllStatuses();
                    }
                } catch (e) {
                    console.error(e);
                    new Notice(`Failed to pull: ${e instanceof Error ? e.message : String(e)}`);
                    // Refresh to show current state
                    await this.refreshAllStatuses();
                }
            });
        }

        if (fileStatus.status === 'modified' && fileStatus.diff) {
            const diffToggle = headerEl.createEl('button', {
                text: 'Show diff',
                cls: 'diff-toggle'
            });

            const diffContainer = fileEl.createDiv({ cls: 'sync-status-diff' });
            diffContainer.addClass('hidden');

            const diffPre = diffContainer.createEl('pre');
            
            const diffLines = fileStatus.diff.split('\n');
            for (const line of diffLines) {
                let type: 'header' | 'added' | 'removed' | 'unchanged' = 'unchanged';
                if (line.startsWith('---') || line.startsWith('+++')) type = 'header';
                else if (line.startsWith('+ ')) type = 'added';
                else if (line.startsWith('- ')) type = 'removed';
                
                const lineEl = diffPre.createSpan({ cls: `diff-line ${type}` });
                lineEl.textContent = line + '\n';
            }

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

            pushBtn.addEventListener('click', async () => {
                try {
                    // Mark as checking
                    fileStatus.status = 'checking';
                    this.renderView();

                    await this.plugin.sync.pushFile(fileStatus.file || fileStatus.path);

                    // Wait a bit for the remote to update
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await this.refreshFileStatus(fileStatus.file || fileStatus.path);
                    this.renderView();
                } catch (e) {
                    console.error(e);
                    new Notice(`Push failed: ${e instanceof Error ? e.message : String(e)}`);
                    // Refresh to show current state
                    await this.refreshFileStatus(fileStatus.file || fileStatus.path);
                    this.renderView();
                }
            });

            pullBtn.addEventListener('click', async () => {
                try {
                    // Mark as checking
                    fileStatus.status = 'checking';
                    this.renderView();

                    await this.plugin.sync.pullFile(fileStatus.file || fileStatus.path);

                    // Wait a bit for the file to be written
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await this.refreshFileStatus(fileStatus.file || fileStatus.path);
                    this.renderView();
                } catch (e) {
                    console.error(e);
                    new Notice(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
                    // Refresh to show current state
                    await this.refreshFileStatus(fileStatus.file || fileStatus.path);
                    this.renderView();
                }
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

                // Add progress bar
                const progressContainer = statusContainer.createDiv({ cls: 'sync-progress-container' });
                progressContainer.createEl('div', { text: 'Checking files...', cls: 'sync-progress-text' });
                const progressBar = progressContainer.createDiv({ cls: 'sync-progress-bar' });
                const progressFill = progressBar.createDiv({ cls: 'sync-progress-fill' });
                progressFill.style.width = '0%';
            }
        }

        try {
            const allFiles = this.app.vault.getFiles();
            let files = this.plugin.filterFilesByVaultFolder(allFiles);

            // Get remote files
            let remoteFiles = await this.plugin.gitService.listFiles(this.plugin.settings.branch);

            // Load .gitignore rules based on remote files, then filter out ignored paths
            await this.plugin.gitignoreManager.loadGitignores(remoteFiles);
            remoteFiles = remoteFiles.filter(path => !this.plugin.gitignoreManager.isIgnored(path));
            files = files.filter(f => !this.plugin.gitignoreManager.isIgnored(f.path));

            const localFilePaths = new Set(files.map(f => f.path));
            // Use ALL local files (not just vaultFolder-filtered) for remote-only detection,
            // so files like .claude/skills/*.md that live outside vaultFolder are not
            // incorrectly labelled "remote only" when they actually exist locally.
            const allLocalFileMap = new Map<string, TFile>(allFiles.map(f => [f.path, f]));

            // Add local files to status
            for (const file of files) {
                this.fileStatuses.set(file.path, {
                    file,
                    path: file.path,
                    status: 'checking'
                });
            }

            // Add remote-only files to status, or queue cross-vaultFolder files for checking
            const extraFilesToCheck: Array<TFile | string> = [];
            for (const remotePath of remoteFiles) {
                if (!localFilePaths.has(remotePath)) {
                    let localFile = allLocalFileMap.get(remotePath);
                    if (!localFile) {
                        const abstractFile = this.app.vault.getAbstractFileByPath(remotePath);
                        if (abstractFile instanceof TFile) {
                            localFile = abstractFile;
                        }
                    }

                    if (localFile) {
                        // File exists locally but outside vaultFolder – check its real status
                        this.fileStatuses.set(remotePath, {
                            file: localFile,
                            path: remotePath,
                            status: 'checking'
                        });
                        extraFilesToCheck.push(localFile);
                    } else if (await this.app.vault.adapter.exists(remotePath)) {
                        this.fileStatuses.set(remotePath, {
                            path: remotePath,
                            status: 'checking'
                        });
                        extraFilesToCheck.push(remotePath);
                    } else {
                        this.fileStatuses.set(remotePath, {
                            path: remotePath,
                            status: 'remote-only'
                        });
                    }
                }
            }

            this.renderView();

            // Check status for local files with progress
            let filesToCheck: Array<TFile | string> = [...files, ...extraFilesToCheck];
            
            // Final filter for extra files to check (some might be ignored)
            filesToCheck = filesToCheck.filter(f => {
                const path = typeof f === 'string' ? f : f.path;
                return !this.plugin.gitignoreManager.isIgnored(path);
            });
            const totalFiles = filesToCheck.length;
            let checkedFiles = 0;

            for (const file of filesToCheck) {
                await this.refreshFileStatus(file);
                checkedFiles++;

                // Update progress bar
                if (container) {
                    const progressFill = container.querySelector('.sync-progress-fill') as HTMLElement;
                    const progressText = container.querySelector('.sync-progress-text') as HTMLElement;
                    if (progressFill && progressText) {
                        const percentage = Math.round((checkedFiles / totalFiles) * 100);
                        progressFill.style.width = `${percentage}%`;
                        progressText.textContent = `Checking files... ${checkedFiles}/${totalFiles} (${percentage}%)`;
                    }
                }
            }

            this.lastSyncTime = Date.now();
            this.renderView();
            new Notice(`Checked ${files.length} local files and ${remoteFiles.length} remote files`);
        } catch (e) {
            console.error(e);
            new Notice(`Failed to refresh: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.isRefreshing = false;
        }
    }

    private async refreshFileStatus(fileOrPath: TFile | string): Promise<void> {
        try {
            const isString = typeof fileOrPath === 'string';
            const path = isString ? fileOrPath : fileOrPath.path;
            const file = isString ? undefined : fileOrPath;

            const localContent = typeof fileOrPath === 'string'
                ? await this.app.vault.adapter.read(fileOrPath) 
                : await this.app.vault.read(fileOrPath);
            
            const remote = await this.plugin.gitService.getFile(path, this.plugin.settings.branch);

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

            this.fileStatuses.set(path, {
                file,
                path: path,
                status,
                localContent,
                remoteContent: remote.content,
                remoteSha: remote.sha,
                diff
            });

        } catch (e) {
            const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
            console.error(`Error checking ${path}:`, e);
            this.fileStatuses.set(path, {
                file: typeof fileOrPath === 'string' ? undefined : fileOrPath,
                path: path,
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
            .map(s => s.file || s.path);

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

            new Notice(`Push completed. Refreshing status...`);
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
            .map(s => s.file || s.path);

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

            // Wait a bit for files to be written
            await new Promise(resolve => setTimeout(resolve, 1000));

            new Notice(`Pull completed. Refreshing status...`);
            await this.refreshAllStatuses();
        } catch (e) {
            progressNotice.hide();
            console.error(e);
            new Notice(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async pushSelected(): Promise<void> {
        if (this.selectedFiles.size === 0) {
            new Notice('No files selected');
            return;
        }

        const selectedStatuses = Array.from(this.selectedFiles)
            .map(path => this.fileStatuses.get(path))
            .filter(s => s && (s.status === 'modified' || s.status === 'unsynced')) as FileStatus[];

        if (selectedStatuses.length === 0) {
            new Notice('No files can be pushed. Only modified or unsynced files can be pushed.');
            return;
        }

        const files = selectedStatuses.map(s => s.file || s.path);

        const serviceName = this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        const confirmed = await this.showConfirmDialog(`Push ${files.length} selected file(s) to ${serviceName}?`);
        if (!confirmed) return;

        const progressNotice = new Notice(`Pushing 0/${files.length} files...`, 0);

        try {
            const results = await this.plugin.sync.pushAllFiles(files, (current, total, fileName) => {
                progressNotice.setMessage(`Pushing ${current}/${total}: ${fileName}`);
            });

            progressNotice.hide();

            if (results.errors.length > 0) {
                console.error('Push errors:', results.errors);
            }

            this.selectedFiles.clear();

            // Wait a bit for remote to update
            await new Promise(resolve => setTimeout(resolve, 1000));

            new Notice(`Push completed. Refreshing status...`);
            await this.refreshAllStatuses();
        } catch (e) {
            progressNotice.hide();
            console.error(e);
            new Notice(`Push failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async pullSelected(): Promise<void> {
        if (this.selectedFiles.size === 0) {
            new Notice('No files selected');
            return;
        }

        const selectedStatuses = Array.from(this.selectedFiles)
            .map(path => this.fileStatuses.get(path))
            .filter(s => s && (s.status === 'modified' || s.status === 'remote-only')) as FileStatus[];

        if (selectedStatuses.length === 0) {
            new Notice('No files can be pulled. Only modified or remote-only files can be pulled.');
            return;
        }

        const serviceName = this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
        const confirmed = await this.showConfirmDialog(`Pull ${selectedStatuses.length} selected file(s) from ${serviceName}? This will overwrite local changes.`);
        if (!confirmed) return;

        const progressNotice = new Notice(`Pulling 0/${selectedStatuses.length} files...`, 0);

        try {
            let current = 0;
            const errors: string[] = [];

            for (const status of selectedStatuses) {
                current++;
                progressNotice.setMessage(`Pulling ${current}/${selectedStatuses.length}: ${status.path}`);

                try {
                    if (status.status !== 'remote-only') {
                        // Existing file - use sync manager
                        await this.plugin.sync.pullFile(status.file || status.path);
                    } else {
                        // Remote-only file - create it
                        const remote = await this.plugin.gitService.getFile(status.path, this.plugin.settings.branch);
                        if (remote.content) {
                            // Ensure parent directories exist (recursively)
                            const pathParts = status.path.split('/');
                            if (pathParts.length > 1) {
                                let currentPath = '';
                                for (let i = 0; i < pathParts.length - 1; i++) {
                                    currentPath += (i > 0 ? '/' : '') + pathParts[i];
                                    const dir = this.app.vault.getAbstractFileByPath(currentPath);
                                    if (!dir) {
                                        try {
                                            await this.app.vault.createFolder(currentPath);
                                        } catch (e) {
                                            // Folder might already exist, ignore error
                                        }
                                    }
                                }
                            }

                            await this.app.vault.create(status.path, remote.content);

                            // Update sync metadata
                            this.plugin.settings.syncMetadata[status.path] = {
                                lastSyncedSha: remote.sha,
                                lastSyncedAt: Date.now(),
                                lastKnownPath: status.path
                            };
                        }
                    }
                } catch (e) {
                    console.error(`Error pulling ${status.path}:`, e);
                    errors.push(status.path);
                }
            }

            progressNotice.hide();

            // Save settings if any metadata was updated
            await this.plugin.saveSettings();

            if (errors.length > 0) {
                new Notice(`Pulled ${selectedStatuses.length - errors.length}/${selectedStatuses.length} files. ${errors.length} failed.`);
            } else {
                new Notice(`Successfully pulled ${selectedStatuses.length} files`);
            }

            this.selectedFiles.clear();

            // Wait a bit for files to be written
            await new Promise(resolve => setTimeout(resolve, 1000));

            new Notice(`Pull completed. Refreshing status...`);
            await this.refreshAllStatuses();
        } catch (e) {
            progressNotice.hide();
            console.error(e);
            new Notice(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async deleteSelected(): Promise<void> {
        if (this.selectedFiles.size === 0) {
            new Notice('No files selected');
            return;
        }

        const selectedStatuses = Array.from(this.selectedFiles)
            .map(path => this.fileStatuses.get(path))
            .filter(s => s) as FileStatus[];

        const localFiles = selectedStatuses.filter(s => s.status !== 'remote-only');
        const remoteOnlyFiles = selectedStatuses.filter(s => s.status === 'remote-only');

        if (localFiles.length === 0 && remoteOnlyFiles.length === 0) {
            new Notice('No files selected to delete');
            return;
        }

        let confirmMessage = '';
        if (localFiles.length > 0 && remoteOnlyFiles.length > 0) {
            confirmMessage = `Delete ${localFiles.length} local file(s) and ${remoteOnlyFiles.length} remote file(s)? This cannot be undone.`;
        } else if (localFiles.length > 0) {
            confirmMessage = `Delete ${localFiles.length} local file(s)? This cannot be undone.`;
        } else {
            confirmMessage = `Delete ${remoteOnlyFiles.length} remote file(s)? This cannot be undone.`;
        }

        const confirmed = await this.showConfirmDialog(confirmMessage);
        if (!confirmed) return;

        const totalFiles = localFiles.length + remoteOnlyFiles.length;
        const progressNotice = new Notice(`Deleting 0/${totalFiles} files...`, 0);

        try {
            let current = 0;
            const errors: string[] = [];

            // Delete local files
            for (const status of localFiles) {
                current++;
                progressNotice.setMessage(`Deleting local ${current}/${totalFiles}: ${status.path}`);

                try {
                    if (status.file) {
                        await this.app.vault.delete(status.file);
                    } else {
                        await this.app.vault.adapter.remove(status.path);
                    }
                    this.fileStatuses.delete(status.path);
                    this.selectedFiles.delete(status.path);
                } catch (e) {
                    console.error(`Error deleting local ${status.path}:`, e);
                    errors.push(status.path);
                }
            }

            // Delete remote files
            for (const status of remoteOnlyFiles) {
                current++;
                progressNotice.setMessage(`Deleting remote ${current}/${totalFiles}: ${status.path}`);

                try {
                    await this.plugin.gitService.deleteFile(
                        status.path,
                        this.plugin.settings.branch,
                        `Delete ${status.path}`
                    );
                    this.fileStatuses.delete(status.path);
                    this.selectedFiles.delete(status.path);
                } catch (e) {
                    console.error(`Error deleting remote ${status.path}:`, e);
                    errors.push(status.path);
                }
            }

            progressNotice.hide();

            if (errors.length > 0) {
                new Notice(`Deleted ${totalFiles - errors.length}/${totalFiles} files. ${errors.length} failed.`);
            } else {
                new Notice(`Successfully deleted ${totalFiles} files`);
            }

            this.renderView();
        } catch (e) {
            progressNotice.hide();
            console.error(e);
            new Notice(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
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
