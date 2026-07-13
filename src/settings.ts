import {App, PluginSettingTab, Setting, Notice, TextComponent} from 'obsidian';
import GitLabFilesPush from "./main";
import {FolderSuggest} from "./ui/FolderSuggest";
import { ConnectionTestResult } from "./services/git-service-base";

// Minimal shape of Obsidian >= 1.13's SettingDefinitionItem. Declared locally so
// the plugin still type-checks against older Obsidian typings (minAppVersion
// 1.11.0), where this type does not exist. Obsidian only calls
// getSettingDefinitions() on versions that understand it.
interface SettingDefinitionItem {
	name: string;
	render: (setting: unknown, group: { listEl: HTMLElement }) => void;
}

export interface SyncMetadata {
	lastSyncedSha: string;
	lastSyncedAt: number;
	lastKnownPath?: string;
}

export type GitServiceType = 'gitlab' | 'github' | 'gitea';

/**
 * How symbolic links (Git blobs with mode 120000) are synced:
 * - 'real':   recreate a real OS symlink on desktop; on mobile (no symlink API)
 *             fall back to syncing the link target's content as a normal file.
 * - 'follow': always sync the target file's content as a normal file.
 * - 'skip':   ignore symlinks entirely.
 */
export type SymlinkHandling = 'real' | 'follow' | 'skip';

export interface GitLabFilesPushSettings {
	serviceType: GitServiceType;
	gitlabToken: string;
	gitlabBaseUrl: string;
	projectId: string;
	githubToken: string;
	githubOwner: string;
	githubRepo: string;
	giteaToken: string;
	giteaBaseUrl: string;
	giteaOwner: string;
	giteaRepo: string;
	branch: string;
	syncMetadata: Record<string, SyncMetadata>;
    rootPath: string;
    vaultFolder: string;
    symlinkHandling: SymlinkHandling;
    /** Multi-line, .gitignore-style patterns applied locally, in addition to the remote repo's .gitignore rules. */
    ignorePatterns: string;
}

export function getServiceName(settings: GitLabFilesPushSettings): string {
    if (settings.serviceType === 'gitlab') return 'GitLab';
    if (settings.serviceType === 'gitea') return 'Gitea';
    return 'GitHub';
}

/**
 * Resolves the symlink behavior that actually applies. Only GitHub can create or
 * push real symlinks (it has the Git Data API); on other providers "real" is not
 * possible, so it is treated as "skip" to avoid silently turning links into
 * ordinary files.
 */
export function getEffectiveSymlinkHandling(settings: GitLabFilesPushSettings): SymlinkHandling {
    if (settings.symlinkHandling === 'real' && settings.serviceType !== 'github') {
        return 'skip';
    }
    return settings.symlinkHandling;
}

export const DEFAULT_SETTINGS: GitLabFilesPushSettings = {
	serviceType: 'gitlab',
	gitlabToken: '',
	gitlabBaseUrl: 'https://gitlab.com',
	projectId: '',
	githubToken: '',
	githubOwner: '',
	githubRepo: '',
	giteaToken: '',
	giteaBaseUrl: '',
	giteaOwner: '',
	giteaRepo: '',
    rootPath: "",
	branch: 'main',
	syncMetadata: {},
	vaultFolder: '',
	symlinkHandling: 'real',
	ignorePatterns: ''
}

type ConnectionStatusState = 'checking' | 'connected' | 'disconnected';

const CONNECTION_TEST_DEBOUNCE_MS = 800;

export class GitLabSyncSettingTab extends PluginSettingTab {
	plugin: GitLabFilesPush;
	private statusBadgeEl: HTMLElement | null = null;
	private connectionTestTimer: ReturnType<typeof setTimeout> | null = null;
	private connectionTestSeq = 0;

	constructor(app: App, plugin: GitLabFilesPush) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Kept as a fallback for Obsidian < 1.13.0 (older than 1.13, down to
	// minAppVersion 1.11.0), which don't know about getSettingDefinitions()
	// and always call display().
	display(): void {
		this.renderSettings(this.containerEl);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [{
			name: '',
			render: (_setting, group) => {
				this.renderSettings(group.listEl);
			}
		}];
	}

	private refresh(): void {
		// update() only exists on Obsidian >= 1.13. On older versions (down to
		// minAppVersion 1.11.0) re-render manually instead. Accessed via a cast
		// so this compiles against the 1.11 typings, which lack update().
		const maybeUpdate = (this as { update?: () => void }).update;
		if (typeof maybeUpdate === 'function') {
			maybeUpdate.call(this);
		} else {
			this.renderSettings(this.containerEl);
		}
	}

	// Rebuilding the whole settings tab (renderSettings) to refresh the badge
	// would empty and recreate every field, stealing focus mid-typing. The
	// badge element is instead created once per renderSettings pass and
	// updated in place by setStatusBadge().
	private renderConnectionStatus(containerEl: HTMLElement): void {
		this.statusBadgeEl = containerEl.createDiv({ cls: 'gfs-connection-status' });
		this.setStatusBadge('checking');
	}

	private setStatusBadge(state: ConnectionStatusState, detail?: string): void {
		const badge = this.statusBadgeEl;
		if (!badge) return;

		badge.removeClass('is-checking');
		badge.removeClass('is-connected');
		badge.removeClass('is-disconnected');
		badge.addClass(`is-${state}`);

		const labels: Record<ConnectionStatusState, string> = {
			checking: 'Checking…',
			connected: 'Connected',
			disconnected: 'Not connected'
		};
		const label = labels[state];
		badge.setText(detail ? `${label} — ${detail}` : label);
	}

	// Debounced so token/branch fields (which call this on every keystroke)
	// don't hit the remote API on every character typed.
	private scheduleConnectionTest(): void {
		if (this.connectionTestTimer) {
			clearTimeout(this.connectionTestTimer);
		}
		this.connectionTestTimer = setTimeout(() => {
			this.connectionTestTimer = null;
			void this.testConnectionSilently();
		}, CONNECTION_TEST_DEBOUNCE_MS);
	}

	private async testConnectionSilently(): Promise<ConnectionTestResult> {
		const seq = ++this.connectionTestSeq;
		this.setStatusBadge('checking');

		try {
			const result = await this.plugin.gitService.testConnection(this.plugin.settings.branch);
			if (seq !== this.connectionTestSeq) return result;

			if (!result.repoOk) {
				this.setStatusBadge('disconnected', result.error ?? 'could not reach the repository');
			} else if (!result.branchOk) {
				this.setStatusBadge('disconnected', `branch "${this.plugin.settings.branch}" not found`);
			} else {
				this.setStatusBadge('connected');
			}
			return result;
		} catch (e: unknown) {
			if (seq === this.connectionTestSeq) {
				const message = e instanceof Error ? e.message : String(e);
				this.setStatusBadge('disconnected', message);
			}
			throw e;
		}
	}

	private renderSettings(containerEl: HTMLElement): void {
		containerEl.empty();

		this.renderConnectionStatus(containerEl);

		new Setting(containerEl)
			.setName('Git service')
			.setDesc('Choose your Git hosting service')
			.addDropdown(dropdown => dropdown
				.addOption('gitlab', 'GitLab')
				.addOption('github', 'GitHub')
				.addOption('gitea', 'Gitea')
				.setValue(this.plugin.settings.serviceType)
				.onChange((value: string) => {
					this.plugin.settings.serviceType = value as GitServiceType;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.refresh();
				}));

		new Setting(containerEl).setName('').setHeading();

		if (this.plugin.settings.serviceType === 'gitlab') {
			this.displayGitLabSettings(containerEl);
		} else if (this.plugin.settings.serviceType === 'gitea') {
			this.displayGiteaSettings(containerEl);
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
					this.scheduleConnectionTest();
				}));

		new Setting(containerEl)
			.setName('Root path')
			.setDesc('Optional: subfolder in repository (e.g. "notes")')
			.addText(text => {
				text.setPlaceholder('Enter subfolder path')
					.setValue(this.plugin.settings.rootPath)
					.onChange((value) => {
						this.plugin.settings.rootPath = value.replace(/^\/|\/$/g, '');
						void this.plugin.saveSettings();
						this.plugin.initializeGitService();
					});
				FolderSuggest.attach(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName('Vault folder')
			.setDesc('Optional: only sync files in this vault folder (e.g. "sync" to only sync files in the sync folder)')
			.addText(text => {
				text.setPlaceholder('Leave empty to sync all files')
					.setValue(this.plugin.settings.vaultFolder)
					.onChange((value) => {
						this.plugin.settings.vaultFolder = value.replace(/^\/|\/$/g, '');
						void this.plugin.saveSettings();
					});
				FolderSuggest.attach(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName('Ignore patterns')
			.setDesc('Optional: .gitignore-style patterns (one per line) to exclude local files from sync, in addition to the repository\'s own .gitignore.')
			.addTextArea(text => {
				text.setPlaceholder(`${this.app.vault.configDir}/\n*.tmp`)
					.setValue(this.plugin.settings.ignorePatterns)
					.onChange((value) => {
						this.plugin.settings.ignorePatterns = value;
						void this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
			});

		// "Real symlink" needs the Git Data API, which only GitHub offers. For
		// other providers, offer follow/skip only so the option can't mislead.
		const supportsRealSymlink = this.plugin.settings.serviceType === 'github';
		new Setting(containerEl)
			.setName('Symbolic links')
			.setDesc(supportsRealSymlink
				? 'How to sync symlinks: "real" recreates the link on desktop and falls back to the target content on mobile, "follow" always syncs the target content, and "skip" ignores symlinks.'
				: 'How to sync symlinks: "follow" syncs the target content as a normal file, "skip" ignores symlinks. Real symlinks require GitHub.')
			.addDropdown(dropdown => {
				if (supportsRealSymlink) dropdown.addOption('real', 'Real symlink (recommended)');
				dropdown
					.addOption('follow', 'Follow (sync target content)')
					.addOption('skip', 'Skip')
					.setValue(getEffectiveSymlinkHandling(this.plugin.settings))
					.onChange((value: string) => {
						this.plugin.settings.symlinkHandling = value as SymlinkHandling;
						void this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc(`Verify your ${getServiceName(this.plugin.settings)} settings`)
			.addButton(button => button
				.setButtonText('Test connection')
				.onClick(async () => {
					try {
						const result = await this.testConnectionSilently();
						if (!result.repoOk) {
							new Notice(`Connection failed: ${result.error ?? 'could not reach the repository'}`);
						} else if (!result.branchOk) {
							new Notice(
								`Connected, but branch "${this.plugin.settings.branch}" was not found. ` +
								'Check the Branch setting, or confirm the repository has a branch with this name.',
								8000
							);
						} else {
							new Notice(`${getServiceName(this.plugin.settings)} connection successful!`);
						}
					} catch (e: unknown) {
						const message = e instanceof Error ? e.message : String(e);
						new Notice(`Connection failed: ${message}`);
					}
				}));

		this.scheduleConnectionTest();
	}

	// Token fields are masked like a password input (with a toggle to reveal
	// them) since they're secrets that shouldn't sit in plaintext on screen
	// during screen shares, recordings, or shared machines.
	private addTokenSetting(containerEl: HTMLElement, name: string, desc: string, getValue: () => string, onChange: (value: string) => void): void {
		let textComponent: TextComponent;
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				textComponent = text;
				text.inputEl.type = 'password';
				text.setPlaceholder('Enter your token')
					.setValue(getValue())
					.onChange(onChange);
			})
			.addExtraButton(btn => {
				btn.setIcon('eye')
					.setTooltip('Show token')
					.onClick(() => {
						const revealing = textComponent.inputEl.type === 'password';
						textComponent.inputEl.type = revealing ? 'text' : 'password';
						btn.setIcon(revealing ? 'eye-off' : 'eye');
						btn.setTooltip(revealing ? 'Hide token' : 'Show token');
					});
			});
	}

	private displayGitLabSettings(containerEl: HTMLElement): void {
		this.addTokenSetting(
			containerEl,
			'GitLab personal access token',
			'Create a token in GitLab user settings > access tokens with "API" scope',
			() => this.plugin.settings.gitlabToken,
			(value) => {
				this.plugin.settings.gitlabToken = value;
				void this.plugin.saveSettings();
				this.plugin.initializeGitService();
				this.scheduleConnectionTest();
			}
		);

		new Setting(containerEl)
			.setName('GitLab base URL')
			.setDesc('Defaults to https://gitlab.com')
			.addText(text => text
				.setPlaceholder('https://gitlab.com')
				.setValue(this.plugin.settings.gitlabBaseUrl)
				.onChange((value) => {
					this.plugin.settings.gitlabBaseUrl = value || 'https://gitlab.com';
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
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
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));
	}

	private displayGiteaSettings(containerEl: HTMLElement): void {
		this.addTokenSetting(
			containerEl,
			'Gitea personal access token',
			'Create a token in user settings > applications > access tokens',
			() => this.plugin.settings.giteaToken,
			(value) => {
				this.plugin.settings.giteaToken = value;
				void this.plugin.saveSettings();
				this.plugin.initializeGitService();
				this.scheduleConnectionTest();
			}
		);

		new Setting(containerEl)
			.setName('Gitea base URL')
			.setDesc('URL of your Gitea instance (e.g. https://gitea.example.com)')
			.addText(text => text
				.setPlaceholder('https://gitea.example.com')
				.setValue(this.plugin.settings.giteaBaseUrl)
				.onChange((value) => {
					this.plugin.settings.giteaBaseUrl = value;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));

		new Setting(containerEl)
			.setName('Repository owner')
			.setDesc('Gitea username or organization name')
			.addText(text => text
				.setPlaceholder('Username')
				.setValue(this.plugin.settings.giteaOwner)
				.onChange((value) => {
					this.plugin.settings.giteaOwner = value;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));

		new Setting(containerEl)
			.setName('Repository name')
			.setDesc('Name of the repository')
			.addText(text => text
				.setPlaceholder('My notes')
				.setValue(this.plugin.settings.giteaRepo)
				.onChange((value) => {
					this.plugin.settings.giteaRepo = value;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));
	}

	private displayGitHubSettings(containerEl: HTMLElement): void {
		this.addTokenSetting(
			containerEl,
			'GitHub personal access token',
			'Create a token in GitHub settings > developer settings > personal access tokens with "repo" scope',
			() => this.plugin.settings.githubToken,
			(value) => {
				this.plugin.settings.githubToken = value;
				void this.plugin.saveSettings();
				this.plugin.initializeGitService();
				this.scheduleConnectionTest();
			}
		);

		new Setting(containerEl)
			.setName('Repository owner')
			.setDesc('GitHub username or organization name')
			.addText(text => text
				.setPlaceholder('Username')
				.setValue(this.plugin.settings.githubOwner)
				.onChange((value) => {
					this.plugin.settings.githubOwner = value;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));

		new Setting(containerEl)
			.setName('Repository name')
			.setDesc('Name of the GitHub repository')
			.addText(text => text
				.setPlaceholder('My notes')
				.setValue(this.plugin.settings.githubRepo)
				.onChange((value) => {
					this.plugin.settings.githubRepo = value;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));
	}
}
