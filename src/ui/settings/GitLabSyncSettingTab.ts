import { App, Plugin, PluginSettingTab, Setting, Notice, TextComponent, ButtonComponent } from 'obsidian';
import type { ConnectionStatus } from '../../main';
// Type-only: RemoteFolderSuggest.attach() still requires the concrete plugin
// class for its own gitService/settings reads. Widening SettingsHost to cover
// that unrelated widget's needs would leak scope into this PR; narrowing
// RemoteFolderSuggest itself is a separate cleanup, not part of this one.
import type GitLabFilesPush from '../../main';
import type { ConnectionTestResult } from '../../services/git-service-interface';
import { FolderSuggest } from '../FolderSuggest';
import { RemoteFolderSuggest } from '../RemoteFolderSuggest';
import { WhatsNewModal } from '../WhatsNewModal';
import { t, setLanguageOverride, type LanguageSetting } from '../../i18n';
import { CHANGELOG, entryText } from '../../changelog';
import type { GitLabFilesPushSettings, GitServiceType, SymlinkHandling } from '../../settings/model';
import { getServiceName, getEffectiveSymlinkHandling } from '../../settings/helpers';

// Minimal shape of Obsidian >= 1.13's SettingDefinitionItem. Declared locally so
// the plugin still type-checks against older Obsidian typings (minAppVersion
// 1.11.0), where this type does not exist. Obsidian only calls
// getSettingDefinitions() on versions that understand it.
interface SettingDefinitionItem {
    name: string;
    render: (setting: unknown, group: { listEl: HTMLElement }) => void;
}

/**
 * Narrow view of the plugin host this settings tab actually needs, so this UI
 * layer depends on a small behavioral contract instead of the concrete
 * `GitLabFilesPush` class -- keeps this file free to be tested against a
 * plain stub and never creates a `settings UI -> main.ts` value dependency.
 */
export interface SettingsHost {
    settings: GitLabFilesPushSettings;
    manifest: { version: string };
    saveSettings(): Promise<void>;
    initializeGitService(): void;
    testConnection(): Promise<ConnectionTestResult>;
    activateSourceControlView(): Promise<void>;
    onConnectionStatusChange(listener: (status: ConnectionStatus) => void): () => void;
}

const CONNECTION_TEST_DEBOUNCE_MS = 800;

export class GitLabSyncSettingTab extends PluginSettingTab {
    private statusBadgeEl: HTMLElement | null = null;
    private connectionTestTimer: number | null = null;
    private unsubscribeConnectionStatus: (() => void) | null = null;

    /**
     * `plugin` and `host` are almost always the same object; kept as separate
     * parameters (rather than `Plugin & SettingsHost`) so `this.host`'s type
     * only carries SettingsHost's own `settings` declaration -- an
     * intersection with `Plugin` would also carry Plugin's version-gated
     * `settings?: unknown` (Obsidian 1.13+) and trip this repo's
     * `obsidianmd/no-unsupported-api` guard on every `this.host.settings` read.
     */
    constructor(app: App, plugin: Plugin, private readonly host: SettingsHost) {
        super(app, plugin);
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
    // highlights right at the top of the settings tab. Dismissing this only hides
    // the attention banner; release history remains available from Settings.
    private renderWhatsNewBanner(containerEl: HTMLElement): void {
        const currentVersion = this.host.manifest.version;
        if (this.host.settings.bannerDismissedVersion === currentVersion) return;

        const release = CHANGELOG.find(r => r.version === currentVersion);
        const notableEntries = release?.entries.filter(entry => entry.notable) ?? [];
        if (notableEntries.length === 0) return;

        // Onboarding releases already teach their mental model in the modal's
        // step-by-step layout — keep the banner itself to a couple of highlights
        // rather than repeating every notable entry.
        const bannerEntries = release?.onboarding ? notableEntries.slice(0, 2) : notableEntries;

        const banner = containerEl.createDiv({ cls: 'gfs-whats-new-banner' });
        const textEl = banner.createDiv({ cls: 'gfs-whats-new-banner-text' });
        textEl.createEl('strong', { text: t('settings.whatsNewBanner.title', { version: currentVersion }) });
        const list = textEl.createEl('ul', { cls: 'gfs-whats-new-banner-list' });
        for (const entry of bannerEntries) {
            list.createEl('li', { text: entryText(entry) });
        }
        const viewBtn = new ButtonComponent(textEl)
            .setButtonText(t('settings.whatsNewBanner.view'))
            .onClick(() => {
                new WhatsNewModal(this.app, CHANGELOG, () => void this.host.activateSourceControlView()).open();
            });
        viewBtn.buttonEl.addClass('gfs-whats-new-banner-view');

        const dismissBtn = banner.createEl('button', {
            cls: 'gfs-whats-new-banner-dismiss',
            text: '×',
            attr: { 'aria-label': t('settings.whatsNewBanner.dismiss') }
        });
        dismissBtn.addEventListener('click', () => {
            void (async () => {
                this.host.settings.bannerDismissedVersion = currentVersion;
                await this.host.saveSettings();
                this.refresh();
            })();
        });
    }

    private renderReleaseHistorySetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(t('settings.releaseHistory.name'))
            .setDesc(t('settings.releaseHistory.desc'))
            .addButton(button => button
                .setButtonText(t('settings.releaseHistory.button'))
                .onClick(() => {
                    new WhatsNewModal(this.app, CHANGELOG, () => void this.host.activateSourceControlView()).open();
                }));
    }

    // Rebuilding the whole settings tab (renderSettings) to refresh the badge
    // would empty and recreate every field, stealing focus mid-typing. The
    // badge element is instead created once per renderSettings pass and
    // updated in place by setStatusBadge(), driven by the plugin's shared
    // connection status (see main.ts) so it stays in sync with the status bar.
    private renderConnectionStatus(containerEl: HTMLElement): void {
        this.statusBadgeEl = containerEl.createDiv({ cls: 'gfs-connection-status' });
        this.unsubscribeConnectionStatus?.();
        this.unsubscribeConnectionStatus = this.host.onConnectionStatusChange((status) => this.setStatusBadge(status));
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
            void this.host.testConnection();
        }, CONNECTION_TEST_DEBOUNCE_MS);
    }

    private renderSettings(containerEl: HTMLElement): void {
        containerEl.empty();

        this.renderWhatsNewBanner(containerEl);
        this.renderReleaseHistorySetting(containerEl);
        this.renderConnectionStatus(containerEl);

        new Setting(containerEl)
            .setName(t('settings.language.name'))
            .setDesc(t('settings.language.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('system', t('settings.language.option.system'))
                .addOption('en', t('settings.language.option.en'))
                .addOption('zh-tw', t('settings.language.option.zhTw'))
                .addOption('zh-cn', t('settings.language.option.zhCn'))
                .setValue(this.host.settings.language)
                .onChange((value: string) => {
                    this.host.settings.language = value as LanguageSetting;
                    void this.host.saveSettings();
                    setLanguageOverride(this.host.settings.language);
                    this.refresh();
                }));

        new Setting(containerEl)
            .setName(t('settings.gitService.name'))
            .setDesc(t('settings.gitService.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('gitlab', 'GitLab')
                .addOption('github', 'GitHub')
                .addOption('gitea', 'Gitea')
                .setValue(this.host.settings.serviceType)
                .onChange((value: string) => {
                    this.host.settings.serviceType = value as GitServiceType;
                    void this.host.saveSettings();
                    this.host.initializeGitService();
                    this.refresh();
                }));

        new Setting(containerEl).setName('').setHeading();

        if (this.host.settings.serviceType === 'gitlab') {
            this.displayGitLabSettings(containerEl);
        } else if (this.host.settings.serviceType === 'gitea') {
            this.displayGiteaSettings(containerEl);
        } else {
            this.displayGitHubSettings(containerEl);
        }

        new Setting(containerEl)
            .setName(t('settings.branch.name'))
            .setDesc(t('settings.branch.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.branch.placeholder'))
                .setValue(this.host.settings.branch)
                .onChange((value) => {
                    this.host.settings.branch = value || 'main';
                    void this.host.saveSettings();
                    this.scheduleConnectionTest();
                }));

        new Setting(containerEl)
            .setName(t('settings.rootPath.name'))
            .setDesc(t('settings.rootPath.desc'))
            .addText(text => {
                text.setPlaceholder(t('settings.rootPath.placeholder'))
                    .setValue(this.host.settings.rootPath)
                    .onChange((value) => {
                        this.host.settings.rootPath = value.replace(/^\/|\/$/g, '');
                        void this.host.saveSettings();
                        this.host.initializeGitService();
                    });
                RemoteFolderSuggest.attach(this.app, text.inputEl, this.host as unknown as GitLabFilesPush);
            });

        new Setting(containerEl)
            .setName(t('settings.vaultFolder.name'))
            .setDesc(t('settings.vaultFolder.desc'))
            .addText(text => {
                text.setPlaceholder(t('settings.vaultFolder.placeholder'))
                    .setValue(this.host.settings.vaultFolder)
                    .onChange((value) => {
                        this.host.settings.vaultFolder = value.replace(/^\/|\/$/g, '');
                        void this.host.saveSettings();
                    });
                FolderSuggest.attach(this.app, text.inputEl);
            });

        new Setting(containerEl)
            .setName(t('settings.autoRefreshOnStartup.name'))
            .setDesc(t('settings.autoRefreshOnStartup.desc'))
            .addToggle(toggle => toggle
                .setValue(this.host.settings.autoRefreshOnStartup)
                .onChange((value) => {
                    this.host.settings.autoRefreshOnStartup = value;
                    void this.host.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.ignorePatterns.name'))
            .setDesc(t('settings.ignorePatterns.desc'))
            .addTextArea(text => {
                text.setPlaceholder(`${this.app.vault.configDir}/\n*.tmp`)
                    .setValue(this.host.settings.ignorePatterns)
                    .onChange((value) => {
                        this.host.settings.ignorePatterns = value;
                        void this.host.saveSettings();
                    });
                text.inputEl.rows = 4;
            });

        // "Real symlink" needs the Git Data API, which only GitHub offers. For
        // other providers, offer follow/skip only so the option can't mislead.
        const supportsRealSymlink = this.host.settings.serviceType === 'github';
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
                    .setValue(getEffectiveSymlinkHandling(this.host.settings))
                    .onChange((value: string) => {
                        this.host.settings.symlinkHandling = value as SymlinkHandling;
                        void this.host.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(t('settings.testConnection.name'))
            .setDesc(t('settings.testConnection.desc', { service: getServiceName(this.host.settings) }))
            .addButton(button => button
                .setButtonText(t('settings.testConnection.button'))
                .onClick(async () => {
                    try {
                        const result = await this.host.testConnection();
                        if (!result.repoOk) {
                            new Notice(t('settings.testConnection.failed', { reason: result.error ?? t('settings.testConnection.failed.unreachable') }));
                        } else if (!result.branchOk) {
                            new Notice(
                                t('settings.testConnection.branchNotFound.notice', { branch: this.host.settings.branch }),
                                8000
                            );
                        } else {
                            new Notice(t('settings.testConnection.success', { service: getServiceName(this.host.settings) }));
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
            () => this.host.settings.gitlabToken,
            (value) => {
                this.host.settings.gitlabToken = value;
                void this.host.saveSettings();
                this.host.initializeGitService();
                this.scheduleConnectionTest();
            }
        );

        new Setting(containerEl)
            .setName(t('settings.gitlab.baseUrl.name'))
            .setDesc(t('settings.gitlab.baseUrl.desc'))
            .addText(text => text
                .setPlaceholder('https://gitlab.com')
                .setValue(this.host.settings.gitlabBaseUrl)
                .onChange((value) => {
                    this.host.settings.gitlabBaseUrl = value || 'https://gitlab.com';
                    void this.host.saveSettings();
                    this.host.initializeGitService();
                    this.scheduleConnectionTest();
                }));

        new Setting(containerEl)
            .setName(t('settings.gitlab.projectId.name'))
            .setDesc(t('settings.gitlab.projectId.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.gitlab.projectId.placeholder'))
                .setValue(this.host.settings.projectId)
                .onChange((value) => {
                    this.host.settings.projectId = value;
                    void this.host.saveSettings();
                    this.host.initializeGitService();
                    this.scheduleConnectionTest();
                }));
    }

    private displayGiteaSettings(containerEl: HTMLElement): void {
        this.addTokenSetting(
            containerEl,
            t('settings.gitea.token.name'),
            t('settings.gitea.token.desc'),
            () => this.host.settings.giteaToken,
            (value) => {
                this.host.settings.giteaToken = value;
                void this.host.saveSettings();
                this.host.initializeGitService();
                this.scheduleConnectionTest();
            }
        );

        new Setting(containerEl)
            .setName(t('settings.gitea.baseUrl.name'))
            .setDesc(t('settings.gitea.baseUrl.desc'))
            .addText(text => text
                .setPlaceholder('https://gitea.example.com')
                .setValue(this.host.settings.giteaBaseUrl)
                .onChange((value) => {
                    this.host.settings.giteaBaseUrl = value || 'https://gitea.example.com';
                    void this.host.saveSettings();
                    this.host.initializeGitService();
                    this.scheduleConnectionTest();
                }));

        new Setting(containerEl)
            .setName(t('settings.repoOwner.name'))
            .setDesc(t('settings.repoOwner.desc.gitea'))
            .addText(text => text
                .setPlaceholder(t('settings.repoOwner.placeholder'))
                .setValue(this.host.settings.giteaOwner)
                .onChange((value) => {
                    this.host.settings.giteaOwner = value;
                    void this.host.saveSettings();
                    this.host.initializeGitService();
                    this.scheduleConnectionTest();
                }));

        new Setting(containerEl)
            .setName(t('settings.repoName.name'))
            .setDesc(t('settings.repoName.desc.gitea'))
            .addText(text => text
                .setPlaceholder(t('settings.repoName.placeholder'))
                .setValue(this.host.settings.giteaRepo)
                .onChange((value) => {
                    this.host.settings.giteaRepo = value;
                    void this.host.saveSettings();
                    this.host.initializeGitService();
                    this.scheduleConnectionTest();
                }));
    }

    private displayGitHubSettings(containerEl: HTMLElement): void {
        this.addTokenSetting(
            containerEl,
            t('settings.github.token.name'),
            t('settings.github.token.desc'),
            () => this.host.settings.githubToken,
            (value) => {
                this.host.settings.githubToken = value;
                void this.host.saveSettings();
                this.host.initializeGitService();
                this.scheduleConnectionTest();
            }
        );

        new Setting(containerEl)
            .setName(t('settings.repoOwner.name'))
            .setDesc(t('settings.repoOwner.desc.github'))
            .addText(text => text
                .setPlaceholder(t('settings.repoOwner.placeholder'))
                .setValue(this.host.settings.githubOwner)
                .onChange((value) => {
                    this.host.settings.githubOwner = value;
                    void this.host.saveSettings();
                    this.host.initializeGitService();
                    this.scheduleConnectionTest();
                }));

        new Setting(containerEl)
            .setName(t('settings.repoName.name'))
            .setDesc(t('settings.repoName.desc.github'))
            .addText(text => text
                .setPlaceholder(t('settings.repoName.placeholder'))
                .setValue(this.host.settings.githubRepo)
                .onChange((value) => {
                    this.host.settings.githubRepo = value;
                    void this.host.saveSettings();
                    this.host.initializeGitService();
                    this.scheduleConnectionTest();
                }));
    }
}
