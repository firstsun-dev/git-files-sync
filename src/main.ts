import { Plugin, TFile, MarkdownView, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, GitLabFilesPushSettings, GitLabSyncSettingTab } from "./settings";
import { GitLabService } from './services/gitlab-service';
import { GitHubService } from './services/github-service';
import { GitServiceInterface } from './services/git-service-interface';
import { SyncManager } from './logic/sync-manager';
import { SyncStatusView, SYNC_STATUS_VIEW_TYPE } from './ui/SyncStatusView';
import { GitignoreManager } from './logic/gitignore-manager';

export default class GitLabFilesPush extends Plugin {
	settings: GitLabFilesPushSettings;
	gitService: GitServiceInterface;
	sync: SyncManager;
	gitignoreManager: GitignoreManager;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new GitLabSyncSettingTab(this.app, this));

		this.registerView(
			SYNC_STATUS_VIEW_TYPE,
			(leaf) => new SyncStatusView(leaf, this)
		);

		this.addRibbonIcon('list-checks', 'Open sync status', () => {
			void this.activateSyncStatusView();
		});

		this.addCommand({
			id: 'open-sync-status',
			name: 'Open sync status',
			callback: () => {
				void this.activateSyncStatusView();
			}
		});

		this.initializeGitService();
		this.gitignoreManager = new GitignoreManager(this.app, this.gitService, this.settings.branch);
		this.sync = new SyncManager(this.app, this.gitService, this.settings);

		const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

		this.addRibbonIcon('upload-cloud', `Push to ${serviceName}`, (evt: MouseEvent) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file instanceof TFile) {
				void this.sync.pushFile(activeView.file);
			} else {
				new Notice('No active note to push');
			}
		});

		this.addCommand({
			id: 'push-current-file',
			name: `Push current file to ${serviceName}`,
			callback: () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					void this.sync.pushFile(activeView.file);
				}
			}
		});

		this.addCommand({
			id: 'pull-current-file',
			name: `Pull current file from ${serviceName}`,
			callback: () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					void this.sync.pullFile(activeView.file);
				}
			}
		});

		this.addCommand({
			id: 'push-all-files',
			name: 'Push all files',
			callback: () => {
				void this.pushAllFiles();
			}
		});

		this.addCommand({
			id: 'pull-all-files',
			name: 'Pull all files',
			callback: () => {
				void this.pullAllFiles();
			}
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item.setTitle(`Push to ${serviceName}`)
							.setIcon('upload-cloud')
							.onClick(() => { void this.sync.pushFile(file); });
					});
					menu.addItem((item) => {
						item.setTitle(`Pull from ${serviceName}`)
							.setIcon('download-cloud')
							.onClick(() => { void this.sync.pullFile(file); });
					});
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file instanceof TFile && (this.settings.gitlabToken || this.settings.githubToken)) {
					// Optional: Check for updates automatically
					// this.sync.pullFile(file);
				}
			})
		);
	}

	async activateSyncStatusView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(SYNC_STATUS_VIEW_TYPE)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: SYNC_STATUS_VIEW_TYPE,
					active: true,
				});
				leaf = rightLeaf;
			}
		}

		if (leaf) {
			void workspace.revealLeaf(leaf);
		}
	}

	async pushAllFiles(): Promise<void> {
		const allFiles = this.app.vault.getFiles();
		let files = this.filterFilesByVaultFolder(allFiles);
		const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

		const remoteFiles = await this.gitService.listFiles(this.settings.branch);
		await this.gitignoreManager.loadGitignores(remoteFiles);
		files = files.filter(f => !this.gitignoreManager.isIgnored(f.path));

		if (files.length === 0) {
			new Notice('No files to push in the configured vault folder');
			return;
		}

		const confirmed = await this.showConfirmDialog(`Push ${files.length} file(s) to ${serviceName}?`);
		if (!confirmed) return;

		const progressNotice = new Notice(`Pushing 0/${files.length} files...`, 0);

		try {
			const results = await this.sync.pushAllFiles(files, (current, total, fileName) => {
				progressNotice.setMessage(`Pushing ${current}/${total}: ${fileName}`);
			});

			progressNotice.hide();

			if (results.errors.length > 0) {
				console.error('Push errors:', results.errors);
			}
		} catch (e) {
			progressNotice.hide();
			console.error(e);
			new Notice(`Push failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async pullAllFiles(): Promise<void> {
		const allFiles = this.app.vault.getFiles();
		let files = this.filterFilesByVaultFolder(allFiles);
		const serviceName = this.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

		const remoteFiles = await this.gitService.listFiles(this.settings.branch);
		await this.gitignoreManager.loadGitignores(remoteFiles);
		files = files.filter(f => !this.gitignoreManager.isIgnored(f.path));

		if (files.length === 0) {
			new Notice('No files to pull in the configured vault folder');
			return;
		}

		const confirmed = await this.showConfirmDialog(`Pull ${files.length} file(s) from ${serviceName}? This will overwrite local changes.`);
		if (!confirmed) return;

		const progressNotice = new Notice(`Pulling 0/${files.length} files...`, 0);

		try {
			const results = await this.sync.pullAllFiles(files, (current, total, fileName) => {
				progressNotice.setMessage(`Pulling ${current}/${total}: ${fileName}`);
			});

			progressNotice.hide();

			if (results.errors.length > 0) {
				console.error('Pull errors:', results.errors);
			}
		} catch (e) {
			progressNotice.hide();
			console.error(e);
			new Notice(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	filterFilesByVaultFolder(files: TFile[]): TFile[] {
		if (!this.settings.vaultFolder) {
			return files;
		}

		const folderPath = this.settings.vaultFolder + '/';
		return files.filter(file => file.path.startsWith(folderPath) || file.path === this.settings.vaultFolder);
	}

	initializeGitService(): void {
		if (this.settings.serviceType === 'gitlab') {
			this.gitService = new GitLabService(
				this.settings.gitlabBaseUrl,
				this.settings.gitlabToken,
				this.settings.projectId,
				this.settings.rootPath
			);
		} else {
			this.gitService = new GitHubService(
				this.settings.githubToken,
				this.settings.githubOwner,
				this.settings.githubRepo,
				this.settings.rootPath
			);
		}

		if (this.sync) {
			this.sync.updateGitService(this.gitService);
		}
	}

	private showConfirmDialog(message: string): Promise<boolean> {
		return new Promise((resolve) => {
			// eslint-disable-next-line no-alert
			const confirmed = confirm(message);
			resolve(confirmed);
		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<GitLabFilesPushSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.initializeGitService();
	}
}
