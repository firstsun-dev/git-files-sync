import {App, PluginSettingTab, Setting, Notice} from 'obsidian';
import GitLabFilesPush from "./main";

export interface SyncMetadata {
	lastSyncedSha: string;
	lastSyncedAt: number;
}

export interface GitLabFilesPushSettings {
	gitlabToken: string;
	gitlabBaseUrl: string;
	projectId: string;
	branch: string;
	syncMetadata: Record<string, SyncMetadata>;
    rootPath: string;
}

export const DEFAULT_SETTINGS: GitLabFilesPushSettings = {
	gitlabToken: '',
	gitlabBaseUrl: 'https://gitlab.com',
	projectId: '',
    rootPath: "",
	branch: 'main',
	syncMetadata: {}
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
			.setName('GitLab personal access token')
			.setDesc('Create a token in GitLab user settings > access tokens with "API" scope')
			.addText(text => text
				.setPlaceholder('Enter your token')
				.setValue(this.plugin.settings.gitlabToken)
				.onChange(async (value) => {
					this.plugin.settings.gitlabToken = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('GitLab base URL')
			.setDesc('Defaults to https://gitlab.com')
			.addText(text => text
				.setPlaceholder('https://gitlab.com')
				.setValue(this.plugin.settings.gitlabBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.gitlabBaseUrl = value || 'https://gitlab.com';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Project ID')
			.setDesc('Found in GitLab project overview')
			.addText(text => text
				.setPlaceholder('Enter numeric project ID')
				.setValue(this.plugin.settings.projectId)
				.onChange(async (value) => {
					this.plugin.settings.projectId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Branch')
			.setDesc('Branch to push or pull from')
			.addText(text => text
				.setPlaceholder('Main')
				.setValue(this.plugin.settings.branch)
				.onChange(async (value) => {
					this.plugin.settings.branch = value || 'main';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Root path')
			.setDesc('Optional: subfolder in repository (e.g. "notes")')
			.addText(text => text
				.setPlaceholder('Enter subfolder path')
				.setValue(this.plugin.settings.rootPath)
				.onChange(async (value) => {
					this.plugin.settings.rootPath = value.replace(/^\/|\/$/g, '');
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Verify your GitLab settings')
			.addButton(button => button
				.setButtonText('Test connection')
				.onClick(async () => {
					try {
						await this.plugin.gitlab.testConnection();
						new Notice('GitLab connection successful!');
					} catch (e: unknown) {
						const message = e instanceof Error ? e.message : String(e);
						new Notice(`GitLab connection failed: ${message}`);
					}
				}));
	}
}
