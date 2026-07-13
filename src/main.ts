import { Plugin, TFile, MarkdownView, Notice, Platform, setTooltip } from 'obsidian';
import { DEFAULT_SETTINGS, GitLabFilesPushSettings, GitLabSyncSettingTab, getServiceName } from "./settings";
import { GitLabService } from './services/gitlab-service';
import { GitHubService } from './services/github-service';
import { GiteaService } from './services/gitea-service';
import { GitServiceInterface } from './services/git-service-interface';
import { SyncManager } from './logic/sync-manager';
import { SyncStatusView, SYNC_STATUS_VIEW_TYPE } from './ui/SyncStatusView';
import { GitignoreManager } from './logic/gitignore-manager';
import { logger } from './utils/logger';
import { ConfirmModal } from './ui/ConfirmModal';

export default class GitLabFilesPush extends Plugin {
	settings: GitLabFilesPushSettings;
	gitService: GitServiceInterface;
	sync: SyncManager;
	gitignoreManager: GitignoreManager;
	private pushRibbonEl: HTMLElement;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new GitLabSyncSettingTab(this.app, this));

		this.registerView(
			SYNC_STATUS_VIEW_TYPE,
			(leaf) => new SyncStatusView(leaf, this)
		);

		this.addRibbonIcon('git-compare', 'Open sync status', async () => {
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
		this.gitignoreManager = new GitignoreManager(this.app, this.gitService, this.settings.branch, this.settings.rootPath, this.settings.vaultFolder, this.settings.ignorePatterns);
		this.sync = new SyncManager(this.app, this.gitService, this.settings, this.saveSettings.bind(this));

		this.pushRibbonEl = this.addRibbonIcon('upload-cloud', this.pushRibbonLabel(), async () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file instanceof TFile) {
				await this.sync.pushFile(activeView.file);
			} else {
				new Notice('No active note to push');
			}
		});

		// Command names are set once at registration and Obsidian has no API to
		// rename them later, so they stay generic rather than embedding the
		// configured service — otherwise switching service in Settings would
		// leave a stale name in the Command Palette until Obsidian reloads.
		this.addCommand({
			id: 'push-current-file',
			name: 'Push current file',
			callback: async () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					await this.sync.pushFile(activeView.file);
				}
			}
		});

		this.addCommand({
			id: 'pull-current-file',
			name: 'Pull current file',
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

	private pushRibbonLabel(): string {
		return Platform.isMobile ? 'Push' : `Push to ${this.serviceName}`;
	}

	// The ribbon icon's tooltip is set once when addRibbonIcon runs, so it goes
	// stale if the user switches Git service afterwards without reloading the
	// plugin. Re-apply it whenever settings are saved to keep it in sync.
	private updateRibbonTooltip(): void {
		if (this.pushRibbonEl) setTooltip(this.pushRibbonEl, this.pushRibbonLabel());
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

	private async listAllFilesFromAdapter(dirPath: string): Promise<string[]> {
		const results: string[] = [];
		try {
			const { files, folders } = await this.app.vault.adapter.list(dirPath || '');
			results.push(...files);
			for (const folder of folders) {
				const sub = await this.listAllFilesFromAdapter(folder);
				results.push(...sub);
			}
		} catch { /* ignore inaccessible dirs */ }
		return results;
	}

	private async runAllFiles(op: 'push' | 'pull'): Promise<void> {
		const startPath = this.settings.vaultFolder || '';
		const allPaths = await this.listAllFilesFromAdapter(startPath);

		await this.gitService.listFiles(this.settings.branch);
		await this.gitignoreManager.loadGitignores();
		const files = allPaths.filter(p => !this.gitignoreManager.isIgnored(this.getNormalizedPath(p)));

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
				logger.error(`${op} errors:`, results.errors);
			}
		} catch (e) {
			progressNotice.hide();
			logger.error(String(e));
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

	filterPathByVaultFolder(path: string): boolean {
		if (!this.settings.vaultFolder) return true;
		const folderPath = this.settings.vaultFolder + '/';
		return path.startsWith(folderPath) || path === this.settings.vaultFolder;
	}

	getNormalizedPath(path: string): string {
		if (!this.settings.vaultFolder) return path;
		const folderPath = this.settings.vaultFolder + '/';
		if (path.startsWith(folderPath)) {
			return path.substring(folderPath.length);
		}
		if (path === this.settings.vaultFolder) return '';
		return path;
	}

	getVaultPath(normalizedPath: string): string {
		if (!this.settings.vaultFolder) return normalizedPath;
		if (!normalizedPath) return this.settings.vaultFolder;
		return this.settings.vaultFolder + '/' + normalizedPath;
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
		} else if (this.settings.serviceType === 'gitea') {
			const service = new GiteaService();
			service.updateConfig(
				this.settings.giteaBaseUrl,
				this.settings.giteaToken,
				this.settings.giteaOwner,
				this.settings.giteaRepo,
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
		this.updateRibbonTooltip();
	}
}
