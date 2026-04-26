import { Plugin, TFile, MarkdownView, Notice, Platform } from 'obsidian';
import { DEFAULT_SETTINGS, GitLabFilesPushSettings, GitLabSyncSettingTab, getServiceName } from "./settings";
import { GitLabService } from './services/gitlab-service';
import { GitHubService } from './services/github-service';
import { GitServiceInterface } from './services/git-service-interface';
import { SyncManager } from './logic/sync-manager';
import { SyncStatusView, SYNC_STATUS_VIEW_TYPE } from './ui/SyncStatusView';
import { GitignoreManager } from './logic/gitignore-manager';
import { ConfirmModal } from './ui/ConfirmModal';

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

		this.addRibbonIcon('list-checks', 'Open sync status', async () => {
			await this.activateSyncStatusView();
		});

		this.addCommand({
			id: 'open-sync-status',
			name: 'Open sync status',
			callback: async () => {
				await this.activateSyncStatusView();
			}
		});

		this.initializeGitService();
		this.gitignoreManager = new GitignoreManager(this.app, this.gitService, this.settings.branch, this.settings.rootPath);
		this.sync = new SyncManager(this.app, this.gitService, this.settings, this.saveSettings.bind(this));

		this.addRibbonIcon('upload-cloud', Platform.isMobile ? `Push` : `Push to ${this.serviceName}`, async () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file instanceof TFile) {
				await this.sync.pushFile(activeView.file);
			} else {
				new Notice('No active note to push');
			}
		});

		this.addCommand({
			id: 'push-current-file',
			name: `Push current file to ${this.serviceName}`,
			callback: async () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					await this.sync.pushFile(activeView.file);
				}
			}
		});

		this.addCommand({
			id: 'pull-current-file',
			name: `Pull current file from ${this.serviceName}`,
			callback: async () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					await this.sync.pullFile(activeView.file);
				}
			}
		});

		this.addCommand({
			id: 'push-all-files',
			name: 'Push all files',
			callback: async () => {
				await this.pushAllFiles();
			}
		});

		this.addCommand({
			id: 'pull-all-files',
			name: 'Pull all files',
			callback: async () => {
				await this.pullAllFiles();
			}
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item.setTitle(`Push to ${this.serviceName}`)
							.setIcon('upload-cloud')
							.onClick(async () => { await this.sync.pushFile(file); });
					});
					menu.addItem((item) => {
						item.setTitle(`Pull from ${this.serviceName}`)
							.setIcon('download-cloud')
							.onClick(async () => { await this.sync.pullFile(file); });
					});
				}
			})
		);
	}

	private get serviceName(): string {
		return getServiceName(this.settings);
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
			await workspace.revealLeaf(leaf);
		}
	}

	async pushAllFiles(): Promise<void> {
		await this.runAllFiles('push');
	}

	async pullAllFiles(): Promise<void> {
		await this.runAllFiles('pull');
	}

	private async runAllFiles(op: 'push' | 'pull'): Promise<void> {
		const allFiles = this.app.vault.getFiles();
		let files = this.filterFilesByVaultFolder(allFiles);

		await this.gitService.listFiles(this.settings.branch);
		await this.gitignoreManager.loadGitignores();
		files = files.filter(f => !this.gitignoreManager.isIgnored(f.path));

		if (files.length === 0) {
			new Notice(`No files to ${op} in the configured vault folder`);
			return;
		}

		const msg = op === 'push'
			? `Push ${files.length} file(s) to ${this.serviceName}?`
			: `Pull ${files.length} file(s) from ${this.serviceName}? This will overwrite local changes.`;

		const confirmed = await this.showConfirmDialog(msg);
		if (!confirmed) return;

		const progressNotice = new Notice(`${op === 'push' ? 'Pushing' : 'Pulling'} 0/${files.length} files...`, 0);

		try {
			const results = op === 'push'
				? await this.sync.pushAllFiles(files, (current, total, fileName) => {
					progressNotice.setMessage(`Pushing ${current}/${total}: ${fileName}`);
				})
				: await this.sync.pullAllFiles(files, (current, total, fileName) => {
					progressNotice.setMessage(`Pulling ${current}/${total}: ${fileName}`);
				});

			progressNotice.hide();

			if (results.errors.length > 0) {
				console.error(`${op} errors:`, results.errors);
			}
		} catch (e) {
			progressNotice.hide();
			console.error(e);
			new Notice(`${op === 'push' ? 'Push' : 'Pull'} failed: ${e instanceof Error ? e.message : String(e)}`);
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
			const service = new GitLabService();
			service.updateConfig(
				this.settings.gitlabBaseUrl,
				this.settings.gitlabToken,
				this.settings.projectId,
				this.settings.rootPath
			);
			this.gitService = service;
		} else {
			const service = new GitHubService();
			service.updateConfig(
				this.settings.githubToken,
				this.settings.githubOwner,
				this.settings.githubRepo,
				this.settings.rootPath
			);
			this.gitService = service;
		}

		if (this.sync) {
			this.sync.updateGitService(this.gitService);
		}
	}

	private showConfirmDialog(message: string): Promise<boolean> {
		return new Promise((resolve) => {
			new ConfirmModal(
				this.app,
				message,
				() => resolve(true),
				() => resolve(false)
			).open();
		});
	}

	onunload() {
		// Cleanup is handled by Obsidian for registered components
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<GitLabFilesPushSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.initializeGitService();
	}
}
