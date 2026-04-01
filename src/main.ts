import { Plugin, TFile, MarkdownView, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, GitLabFilesPushSettings, GitLabSyncSettingTab } from "./settings";
import { GitLabService } from './services/gitlab-service';
import { SyncManager } from './logic/sync-manager';

export default class GitLabFilesPush extends Plugin {
	settings: GitLabFilesPushSettings;
	gitlab: GitLabService;
	sync: SyncManager;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new GitLabSyncSettingTab(this.app, this));

		this.gitlab = new GitLabService(
			this.settings.gitlabBaseUrl,
			this.settings.gitlabToken,
			this.settings.projectId
		);

		this.sync = new SyncManager(this.app, this.gitlab, this.settings);

		this.addRibbonIcon('upload-cloud', 'Push to GitLab', (evt: MouseEvent) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file instanceof TFile) {
				void this.sync.pushFile(activeView.file);
			} else {
				new Notice('No active note to push.');
			}
		});

		this.addCommand({
			id: 'push-current-file',
			name: 'Push current file to GitLab',
			callback: () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					void this.sync.pushFile(activeView.file);
				}
			}
		});

		this.addCommand({
			id: 'pull-current-file',
			name: 'Pull current file from GitLab',
			callback: () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					void this.sync.pullFile(activeView.file);
				}
			}
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item.setTitle('Push to GitLab')
							.setIcon('upload-cloud')
							.onClick(() => { void this.sync.pushFile(file); });
					});
					menu.addItem((item) => {
						item.setTitle('Pull from GitLab')
							.setIcon('download-cloud')
							.onClick(() => { void this.sync.pullFile(file); });
					});
				}
			})
		);

		// Phase 4: Pull-on-open logic (Trigger on file-open)
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file instanceof TFile && this.settings.gitlabToken) {
					// Optional: Check for updates automatically
					// this.sync.pullFile(file);
				}
			})
		);
	}

	onunload() {
		// Clean up resources if needed
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<GitLabFilesPushSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
