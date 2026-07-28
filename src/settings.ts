import {App, PluginSettingTab, Setting, Notice, TextComponent} from 'obsidian';
import GitLabFilesPush, { type ConnectionStatus } from "./main";
import {FolderSuggest} from "./ui/FolderSuggest";
import {RemoteFolderSuggest} from "./ui/RemoteFolderSuggest";
import { t, setLanguageOverride, type LanguageSetting } from "./i18n";
import { CHANGELOG, entryText } from "./changelog";

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
	/**
	 * Set when the vault's 'rename' event moved this entry from another path
	 * and the move hasn't been pushed yet. Always the path still live on the
	 * remote — a chain of renames (A→B→C) collapses to this pointing at A, not
	 * the most recent hop, so pushing deletes the right remote path.
	 */
	renamedFrom?: string;
}

/**
 * Metadata written before `lastKnownPath` was introduced used its record key
 * as the path. Keep that format eligible for rename reconciliation.
 */
export function isSyncMetadataAtPath(metadata: SyncMetadata | undefined, path: string): metadata is SyncMetadata {
	return metadata !== undefined && (metadata.lastKnownPath === undefined || metadata.lastKnownPath === path);
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
    /** Plugin version last seen by this vault, used to show a "what's new" tip after an update. */
    lastSeenVersion: string;
    /** Version whose "what's new" banner in the settings tab has been dismissed, if any. */
    bannerDismissedVersion: string;
    /** UI language. 'system' follows Obsidian's display language, falling back to English if unsupported. */
    language: LanguageSetting;
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
	ignorePatterns: '',
	lastSeenVersion: '',
	bannerDismissedVersion: '',
	language: 'system'
}

const CONNECTION_TEST_DEBOUNCE_MS = 800;

export class GitLabSyncSettingTab extends PluginSettingTab {
	plugin: GitLabFilesPush;
	private statusBadgeEl: HTMLElement | null = null;
	private connectionTestTimer: number | null = null;
	private unsubscribeConnectionStatus: (() => void) | null = null;

	constructor(app: App, plugin: GitLabFilesPush) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// The status badge mirrors the plugin's shared connection status (also
	// driving the status bar item) instead of running its own test, so both
	// stay in sync and don't race separate requests against the remote API.
	hide(): void {
		this.unsubscribeConnectionStatus?.();
		this.unsubscribeConnectionStatus = null;
		if (this.connectionTestTimer) {
			window.clearTimeout(this.connectionTestTimer);
			this.connectionTestTimer = null;
		}
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

	// Persistent (until dismissed) banner surfacing the current version's notable
	// highlights right at the top of the settings tab, so users who dismissed or
	// never saw the WhatsNewModal (see main.ts) can still find them. Separate
	// from `lastSeenVersion` — that gate controls the once-per-upgrade modal,
	// this one just tracks whether the banner itself was dismissed.
	private renderWhatsNewBanner(containerEl: HTMLElement): void {
		const currentVersion = this.plugin.manifest.version;
		if (this.plugin.settings.bannerDismissedVersion === currentVersion) return;

		const release = CHANGELOG.find(r => r.version === currentVersion);
		const notableEntries = release?.entries.filter(entry => entry.notable) ?? [];
		if (notableEntries.length === 0) return;

		const banner = containerEl.createDiv({ cls: 'gfs-whats-new-banner' });
		const textEl = banner.createDiv({ cls: 'gfs-whats-new-banner-text' });
		textEl.createEl('strong', { text: t('settings.whatsNewBanner.title', { version: currentVersion }) });
		const list = textEl.createEl('ul', { cls: 'gfs-whats-new-banner-list' });
		for (const entry of notableEntries) {
			list.createEl('li', { text: entryText(entry) });
		}

		const dismissBtn = banner.createEl('button', {
			cls: 'gfs-whats-new-banner-dismiss',
			text: '×',
			attr: { 'aria-label': t('settings.whatsNewBanner.dismiss') }
		});
		dismissBtn.addEventListener('click', () => {
			void (async () => {
				this.plugin.settings.bannerDismissedVersion = currentVersion;
				await this.plugin.saveSettings();
				this.refresh();
			})();
		});
	}

	// Rebuilding the whole settings tab (renderSettings) to refresh the badge
	// would empty and recreate every field, stealing focus mid-typing. The
	// badge element is instead created once per renderSettings pass and
	// updated in place by setStatusBadge(), driven by the plugin's shared
	// connection status (see main.ts) so it stays in sync with the status bar.
	private renderConnectionStatus(containerEl: HTMLElement): void {
		this.statusBadgeEl = containerEl.createDiv({ cls: 'gfs-connection-status' });
		this.unsubscribeConnectionStatus?.();
		this.unsubscribeConnectionStatus = this.plugin.onConnectionStatusChange((status) => this.setStatusBadge(status));
	}

	private setStatusBadge(status: ConnectionStatus): void {
		const badge = this.statusBadgeEl;
		if (!badge) return;

		badge.removeClass('is-checking', 'is-connected', 'is-disconnected');
		badge.addClass(`is-${status.state}`);

		const labels: Record<ConnectionStatus['state'], string> = {
			checking: t('settings.connectionStatus.checking'),
			connected: t('settings.connectionStatus.connected'),
			disconnected: t('settings.connectionStatus.disconnected')
		};
		const label = labels[status.state];
		badge.setText(status.detail ? t('settings.connectionStatus.withDetail', { label, detail: status.detail }) : label);
	}

	// Debounced so token/branch fields (which call this on every keystroke)
	// don't hit the remote API on every character typed.
	private scheduleConnectionTest(): void {
		if (this.connectionTestTimer) {
			window.clearTimeout(this.connectionTestTimer);
		}
		this.connectionTestTimer = window.setTimeout(() => {
			this.connectionTestTimer = null;
			void this.plugin.testConnection();
		}, CONNECTION_TEST_DEBOUNCE_MS);
	}

	private renderSettings(containerEl: HTMLElement): void {
		containerEl.empty();

		this.renderWhatsNewBanner(containerEl);
		this.renderConnectionStatus(containerEl);

		new Setting(containerEl)
			.setName(t('settings.language.name'))
			.setDesc(t('settings.language.desc'))
			.addDropdown(dropdown => dropdown
				.addOption('system', t('settings.language.option.system'))
				.addOption('en', t('settings.language.option.en'))
				.addOption('zh-tw', t('settings.language.option.zhTw'))
				.addOption('zh-cn', t('settings.language.option.zhCn'))
				.setValue(this.plugin.settings.language)
				.onChange((value: string) => {
					this.plugin.settings.language = value as LanguageSetting;
					void this.plugin.saveSettings();
					setLanguageOverride(this.plugin.settings.language);
					this.refresh();
				}));

		new Setting(containerEl)
			.setName(t('settings.gitService.name'))
			.setDesc(t('settings.gitService.desc'))
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
			.setName(t('settings.branch.name'))
			.setDesc(t('settings.branch.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.branch.placeholder'))
				.setValue(this.plugin.settings.branch)
				.onChange((value) => {
					this.plugin.settings.branch = value || 'main';
					void this.plugin.saveSettings();
					this.scheduleConnectionTest();
				}));

		new Setting(containerEl)
			.setName(t('settings.rootPath.name'))
			.setDesc(t('settings.rootPath.desc'))
			.addText(text => {
				text.setPlaceholder(t('settings.rootPath.placeholder'))
					.setValue(this.plugin.settings.rootPath)
					.onChange((value) => {
						this.plugin.settings.rootPath = value.replace(/^\/|\/$/g, '');
						void this.plugin.saveSettings();
						this.plugin.initializeGitService();
					});
				RemoteFolderSuggest.attach(this.app, text.inputEl, this.plugin);
			});

		new Setting(containerEl)
			.setName(t('settings.vaultFolder.name'))
			.setDesc(t('settings.vaultFolder.desc'))
			.addText(text => {
				text.setPlaceholder(t('settings.vaultFolder.placeholder'))
					.setValue(this.plugin.settings.vaultFolder)
					.onChange((value) => {
						this.plugin.settings.vaultFolder = value.replace(/^\/|\/$/g, '');
						void this.plugin.saveSettings();
					});
				FolderSuggest.attach(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName(t('settings.ignorePatterns.name'))
			.setDesc(t('settings.ignorePatterns.desc'))
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
			.setName(t('settings.symlinks.name'))
			.setDesc(supportsRealSymlink
				? t('settings.symlinks.desc.supported')
				: t('settings.symlinks.desc.unsupported'))
			.addDropdown(dropdown => {
				if (supportsRealSymlink) dropdown.addOption('real', t('settings.symlinks.option.real'));
				dropdown
					.addOption('follow', t('settings.symlinks.option.follow'))
					.addOption('skip', t('settings.symlinks.option.skip'))
					.setValue(getEffectiveSymlinkHandling(this.plugin.settings))
					.onChange((value: string) => {
						this.plugin.settings.symlinkHandling = value as SymlinkHandling;
						void this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.testConnection.name'))
			.setDesc(t('settings.testConnection.desc', { service: getServiceName(this.plugin.settings) }))
			.addButton(button => button
				.setButtonText(t('settings.testConnection.button'))
				.onClick(async () => {
					try {
						const result = await this.plugin.testConnection();
						if (!result.repoOk) {
							new Notice(t('settings.testConnection.failed', { reason: result.error ?? t('settings.testConnection.failed.unreachable') }));
						} else if (!result.branchOk) {
							new Notice(
								t('settings.testConnection.branchNotFound.notice', { branch: this.plugin.settings.branch }),
								8000
							);
						} else {
							new Notice(t('settings.testConnection.success', { service: getServiceName(this.plugin.settings) }));
						}
					} catch (e: unknown) {
						const message = e instanceof Error ? e.message : String(e);
						new Notice(t('settings.testConnection.failed', { reason: message }));
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
				text.setPlaceholder(t('settings.token.placeholder'))
					.setValue(getValue())
					.onChange(onChange);
			})
			.addExtraButton(btn => {
				btn.setIcon('eye')
					.setTooltip(t('settings.token.show'))
					.onClick(() => {
						const revealing = textComponent.inputEl.type === 'password';
						textComponent.inputEl.type = revealing ? 'text' : 'password';
						btn.setIcon(revealing ? 'eye-off' : 'eye');
						btn.setTooltip(revealing ? t('settings.token.hide') : t('settings.token.show'));
					});
			});
	}

	private displayGitLabSettings(containerEl: HTMLElement): void {
		this.addTokenSetting(
			containerEl,
			t('settings.gitlab.token.name'),
			t('settings.gitlab.token.desc'),
			() => this.plugin.settings.gitlabToken,
			(value) => {
				this.plugin.settings.gitlabToken = value;
				void this.plugin.saveSettings();
				this.plugin.initializeGitService();
				this.scheduleConnectionTest();
			}
		);

		new Setting(containerEl)
			.setName(t('settings.gitlab.baseUrl.name'))
			.setDesc(t('settings.gitlab.baseUrl.desc'))
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
			.setName(t('settings.gitlab.projectId.name'))
			.setDesc(t('settings.gitlab.projectId.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.gitlab.projectId.placeholder'))
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
			t('settings.gitea.token.name'),
			t('settings.gitea.token.desc'),
			() => this.plugin.settings.giteaToken,
			(value) => {
				this.plugin.settings.giteaToken = value;
				void this.plugin.saveSettings();
				this.plugin.initializeGitService();
				this.scheduleConnectionTest();
			}
		);

		new Setting(containerEl)
			.setName(t('settings.gitea.baseUrl.name'))
			.setDesc(t('settings.gitea.baseUrl.desc'))
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
			.setName(t('settings.repoOwner.name'))
			.setDesc(t('settings.repoOwner.desc.gitea'))
			.addText(text => text
				.setPlaceholder(t('settings.repoOwner.placeholder'))
				.setValue(this.plugin.settings.giteaOwner)
				.onChange((value) => {
					this.plugin.settings.giteaOwner = value;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));

		new Setting(containerEl)
			.setName(t('settings.repoName.name'))
			.setDesc(t('settings.repoName.desc.gitea'))
			.addText(text => text
				.setPlaceholder(t('settings.repoName.placeholder'))
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
			t('settings.github.token.name'),
			t('settings.github.token.desc'),
			() => this.plugin.settings.githubToken,
			(value) => {
				this.plugin.settings.githubToken = value;
				void this.plugin.saveSettings();
				this.plugin.initializeGitService();
				this.scheduleConnectionTest();
			}
		);

		new Setting(containerEl)
			.setName(t('settings.repoOwner.name'))
			.setDesc(t('settings.repoOwner.desc.github'))
			.addText(text => text
				.setPlaceholder(t('settings.repoOwner.placeholder'))
				.setValue(this.plugin.settings.githubOwner)
				.onChange((value) => {
					this.plugin.settings.githubOwner = value;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));

		new Setting(containerEl)
			.setName(t('settings.repoName.name'))
			.setDesc(t('settings.repoName.desc.github'))
			.addText(text => text
				.setPlaceholder(t('settings.repoName.placeholder'))
				.setValue(this.plugin.settings.githubRepo)
				.onChange((value) => {
					this.plugin.settings.githubRepo = value;
					void this.plugin.saveSettings();
					this.plugin.initializeGitService();
					this.scheduleConnectionTest();
				}));
	}
}
