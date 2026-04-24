import {App, PluginSettingTab, Setting, Notice} from 'obsidian';
import GitLabFilesPush from "./main";

export interface SyncMetadata {
	lastSyncedSha: string;
	lastSyncedAt: number;
	lastKnownPath?: string;
}

export type GitServiceType = 'gitlab' | 'github';

export interface GitLabFilesPushSettings {
	serviceType: GitServiceType;
	gitlabToken: string;
	gitlabBaseUrl: string;
	projectId: string;
	githubToken: string;
	githubOwner: string;
	githubRepo: string;
	branch: string;
	syncMetadata: Record<string, SyncMetadata>;
    rootPath: string;
    vaultFolder: string;
}

export const DEFAULT_SETTINGS: GitLabFilesPushSettings = {
	serviceType: 'gitlab',
	gitlabToken: '',
	gitlabBaseUrl: 'https://gitlab.com',
	projectId: '',
	githubToken: '',
	githubOwner: '',
	githubRepo: '',
    rootPath: "",
	branch: 'main',
	syncMetadata: {},
	vaultFolder: ''
}

export class GitLabSyncSettingTab extends PluginSettingTab {
	plugin: GitLabFilesPush;

	constructor(app: App, plugin: GitLabFilesPush) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Git service')
			.setDesc('Choose between GitLab or GitHub')
			.addDropdown(dropdown => dropdown
				.addOption('gitlab', 'GitLab')
				.addOption('github', 'GitHub')
				.setValue(this.plugin.settings.serviceType)
				.onChange((value: string) => {
					this.plugin.settings.serviceType = value as GitServiceType;
					void this.plugin.saveSettings();
					void this.plugin.initializeGitService();
					this.display();
				}));

		new Setting(containerEl).setName('').setHeading();

		if (this.plugin.settings.serviceType === 'gitlab') {
			this.displayGitLabSettings(containerEl);
		} else {
			this.displayGitHubSettings(containerEl);
		}

		new Setting(containerEl)
			.setName('Branch')
			.setDesc('Branch to push or pull from')
			.addText(text => text
				.setPlaceholder('Main')
				.setValue(this.plugin.settings.branch)
				.onChange((value) => {
					this.plugin.settings.branch = value || 'main';
					void this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Root path')
			.setDesc('Optional: subfolder in repository (e.g. "notes")')
			.addText(text => text
				.setPlaceholder('Enter subfolder path')
				.setValue(this.plugin.settings.rootPath)
				.onChange((value) => {
					this.plugin.settings.rootPath = value.replace(/^\/|\/$/g, '');
					void this.plugin.saveSettings();
					void this.plugin.initializeGitService();
				}));

		new Setting(containerEl)
			.setName('Vault folder')
			.setDesc('Optional: only sync files in this vault folder (e.g. "sync" to only sync files in the sync folder)')
			.addText(text => text
				.setPlaceholder('Leave empty to sync all files')
				.setValue(this.plugin.settings.vaultFolder)
				.onChange((value) => {
					this.plugin.settings.vaultFolder = value.replace(/^\/|\/$/g, '');
					void this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc(`Verify your ${this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub'} settings`)
			.addButton(button => button
				.setButtonText('Test connection')
				.onClick(async () => {
					try {
						await this.plugin.gitService.testConnection();
						new Notice(`${this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub'} connection successful!`);
					} catch (e: unknown) {
						const message = e instanceof Error ? e.message : String(e);
						new Notice(`Connection failed: ${message}`);
					}
				}));
	}

	private displayGitLabSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('GitLab personal access token')
			.setDesc('Create a token in GitLab user settings > access tokens with "API" scope')
			.addText(text => text
				.setPlaceholder('Enter your token')
				.setValue(this.plugin.settings.gitlabToken)
				.onChange((value) => {
					this.plugin.settings.gitlabToken = value;
					void this.plugin.saveSettings();
					void this.plugin.initializeGitService();
				}));

		new Setting(containerEl)
			.setName('GitLab base URL')
			.setDesc('Defaults to https://gitlab.com')
			.addText(text => text
				.setPlaceholder('https://gitlab.com')
				.setValue(this.plugin.settings.gitlabBaseUrl)
				.onChange((value) => {
					this.plugin.settings.gitlabBaseUrl = value || 'https://gitlab.com';
					void this.plugin.saveSettings();
					void this.plugin.initializeGitService();
				}));

		new Setting(containerEl)
			.setName('Project ID')
			.setDesc('Found in GitLab project overview')
			.addText(text => text
				.setPlaceholder('Enter numeric project ID')
				.setValue(this.plugin.settings.projectId)
				.onChange((value) => {
					this.plugin.settings.projectId = value;
					void this.plugin.saveSettings();
					void this.plugin.initializeGitService();
				}));
	}

	private displayGitHubSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('GitHub personal access token')
			.setDesc('Create a token in GitHub settings > Developer settings > Personal access tokens with "repo" scope')
			.addText(text => text
				.setPlaceholder('Enter your token')
				.setValue(this.plugin.settings.githubToken)
				.onChange((value) => {
					this.plugin.settings.githubToken = value;
					void this.plugin.saveSettings();
					void this.plugin.initializeGitService();
				}));

		new Setting(containerEl)
			.setName('Repository owner')
			.setDesc('GitHub username or organization name')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(this.plugin.settings.githubOwner)
				.onChange((value) => {
					this.plugin.settings.githubOwner = value;
					void this.plugin.saveSettings();
					void this.plugin.initializeGitService();
				}));

		new Setting(containerEl)
			.setName('Repository name')
			.setDesc('Name of the GitHub repository')
			.addText(text => text
				.setPlaceholder('my-notes')
				.setValue(this.plugin.settings.githubRepo)
				.onChange((value) => {
					this.plugin.settings.githubRepo = value;
					void this.plugin.saveSettings();
					void this.plugin.initializeGitService();
				}));
	}
}
