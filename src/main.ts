import { Plugin, TFile, TFolder, MarkdownView, Notice, Platform, setTooltip, setIcon, type WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, GitLabFilesPushSettings, GitLabSyncSettingTab, getServiceName } from "./settings";
import { GitLabService } from './services/gitlab-service';
import { GitHubService } from './services/github-service';
import { GiteaService } from './services/gitea-service';
import { GitServiceInterface, GitTreeEntry } from './services/git-service-interface';
import { ConnectionTestResult } from './services/git-service-base';
import { SyncManager } from './logic/sync-manager';
import { SourceControlItemView, SOURCE_CONTROL_VIEW_TYPE } from './ui/source-control/SourceControlItemView';
import { DiffTabView, SOURCE_CONTROL_DIFF_VIEW_TYPE, type DiffTabContent } from './ui/source-control/DiffTabView';
import { GitignoreManager } from './logic/gitignore-manager';
import { logger } from './utils/logger';
import { ConfirmModal } from './ui/ConfirmModal';
import { WhatsNewModal } from './ui/WhatsNewModal';
import { CHANGELOG, getUnseenReleases } from './changelog';
import { compareVersions } from './utils/version';
import { t, setLanguageOverride } from './i18n';
import { ObsidianSyncInteraction } from './ui/ObsidianSyncInteraction';
import { SyncStatusRefreshService } from './logic/sync/SyncStatusRefreshService';
import { SyncDiffService } from './logic/sync/SyncDiffService';
import { SyncManagerWorkspace, type SyncWorkspace } from './logic/sync/SyncWorkspace';
import { ChangeRepository } from './logic/source-control/ChangeRepository';
import { OperationState } from './logic/source-control/OperationState';
import { RefreshState } from './logic/source-control/RefreshState';
import { SyncSelectionStore } from './logic/source-control/SyncSelectionStore';
import { SourceControlViewModel } from './logic/source-control/SourceControlViewModel';
import { SourceControlActionService } from './logic/source-control/SourceControlActionService';
import { SyncResultNotifier } from './logic/source-control/SyncResultNotifier';
import { toSyncChanges } from './logic/source-control/FileStatusAdapter';

export type ConnectionStatusState = 'checking' | 'connected' | 'disconnected';

export interface ConnectionStatus {
	state: ConnectionStatusState;
	detail?: string;
}

export default class GitLabFilesPush extends Plugin {
	settings: GitLabFilesPushSettings;
	gitService: GitServiceInterface;
	sync: SyncManager;
	syncWorkspace: SyncWorkspace;
	syncStatusRefresh: SyncStatusRefreshService;
	gitignoreManager: GitignoreManager;
	changeRepository: ChangeRepository;
	syncSelectionStore: SyncSelectionStore;
	operationState: OperationState;
	refreshState: RefreshState;
	sourceControlViewModel: SourceControlViewModel;
	sourceControlActions: SourceControlActionService;
	private unsubscribeChangeRepository?: () => void;
	private gitignoreConfigKey = '';
	private pushRibbonEl: HTMLElement;
	private statusBarEl: HTMLElement;
	connectionStatus: ConnectionStatus = { state: 'checking' };
	private connectionStatusListeners: Set<(status: ConnectionStatus) => void> = new Set();
	private connectionTestSeq = 0;
	private sourceControlActivation?: Promise<void>;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new GitLabSyncSettingTab(this.app, this));

		this.registerView(
			SOURCE_CONTROL_VIEW_TYPE,
			(leaf) => new SourceControlItemView(leaf, this)
		);

		this.registerView(
			SOURCE_CONTROL_DIFF_VIEW_TYPE,
			(leaf) => new DiffTabView(leaf)
		);

		this.addRibbonIcon('git-compare', t('main.ribbon.openSyncStatus'), async () => {
			await this.activateSourceControlView();
		});

		this.addCommand({
			id: 'open-sync-status',
			name: t('main.command.openSyncStatus'),
			callback: async () => {
				await this.activateSourceControlView();
			}
		});

		this.initializeGitService();
		this.updateGitignoreManager();
		this.sync = new SyncManager(
			this.app,
			this.gitService,
			this.settings,
			this.saveSettings.bind(this),
			(path) => this.gitignoreManager.isIgnored(this.getNormalizedPath(path)),
			undefined,
			new ObsidianSyncInteraction(this.app),
		);
		this.syncStatusRefresh = new SyncStatusRefreshService({
			app: this.app,
			settings: () => this.settings,
			gitService: () => this.gitService,
			gitignoreManager: () => this.gitignoreManager,
			syncManager: () => this.sync,
			filterFilesByVaultFolder: files => this.filterFilesByVaultFolder(files),
			filterPathByVaultFolder: path => this.filterPathByVaultFolder(path),
			getNormalizedPath: path => this.getNormalizedPath(path),
			getVaultPath: path => this.getVaultPath(path),
		}, this.sync.status);
		this.syncWorkspace = new SyncManagerWorkspace({
			manager: () => this.sync,
			gitService: () => this.gitService,
			settings: () => this.settings,
			refreshService: this.syncStatusRefresh,
			diffService: new SyncDiffService(this.sync.status, (sha, path) => this.gitService.getBlob(sha, path)),
			normalizePath: path => this.getNormalizedPath(path),
			app: this.app,
		});

		this.changeRepository = new ChangeRepository();
		this.syncSelectionStore = new SyncSelectionStore();
		this.operationState = new OperationState();
		this.refreshState = new RefreshState();
		this.sourceControlViewModel = new SourceControlViewModel(
			this.changeRepository,
			this.syncSelectionStore,
			this.operationState,
			() => this.syncWorkspace.refresh(),
			this.refreshState,
		);
		this.sourceControlActions = new SourceControlActionService(
			this.changeRepository,
			this.operationState,
			this.syncWorkspace,
			new SyncResultNotifier(message => new Notice(message)),
		);
		// Keeps ChangeRepository (and therefore the Source Control view) in
		// sync with the same SyncStatusService instance the sync domain
		// already publishes to -- no separate refresh/polling path.
		this.unsubscribeChangeRepository = this.sync.status.subscribe((statuses) => {
			const changes = toSyncChanges([...statuses.values()]);
			this.changeRepository.replace(changes);
			this.syncSelectionStore.refresh(changes.map(change => change.id));
		});

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass('gfs-status-bar-connection');
		setTooltip(this.statusBarEl, t('settings.connectionStatus.checking'));
		this.registerDomEvent(this.statusBarEl, 'click', () => void this.testConnection());
		this.onConnectionStatusChange((status) => this.renderStatusBarConnection(status));
		void this.testConnection();

		this.pushRibbonEl = this.addRibbonIcon('upload-cloud', this.pushRibbonLabel(), async () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file instanceof TFile) {
				await this.sync.pushFiles([activeView.file]);
			} else {
				new Notice(t('main.notice.noActiveNote'));
			}
		});

		// Command names are set once at registration and Obsidian has no API to
		// rename them later, so they stay generic rather than embedding the
		// configured service — otherwise switching service in Settings would
		// leave a stale name in the Command Palette until Obsidian reloads.
		this.addCommand({
			id: 'push-current-file',
			name: t('main.command.pushCurrentFile'),
			callback: async () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					await this.sync.pushFiles([activeView.file]);
				}
			}
		});

		this.addCommand({
			id: 'pull-current-file',
			name: t('main.command.pullCurrentFile'),
			callback: async () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file instanceof TFile) {
					await this.sync.pullFile(activeView.file);
				}
			}
		});

		this.addCommand({
			id: 'push-all-files',
			name: t('main.command.pushAllFiles'),
			callback: async () => {
				await this.pushAllFiles();
			}
		});

		this.addCommand({
			id: 'pull-all-files',
			name: t('main.command.pullAllFiles'),
			callback: async () => {
				await this.pullAllFiles();
			}
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item.setTitle(t('main.contextMenu.pushTo', { service: this.serviceName }))
							.setIcon('upload-cloud')
							.onClick(async () => { await this.sync.pushFiles([file]); });
					});
					menu.addItem((item) => {
						item.setTitle(t('main.contextMenu.pullFrom', { service: this.serviceName }))
							.setIcon('download-cloud')
							.onClick(async () => { await this.sync.pullFile(file); });
					});
				}
			})
		);

		// Deliberately no vault 'delete' listener clearing syncMetadata here.
		// An out-of-band move (external tool, cloud sync, mobile) often reaches
		// Obsidian's watcher as a bare delete of the old path with no correlated
		// rename event, so eagerly wiping syncMetadata[oldPath] on every delete
		// would destroy the exact evidence SyncStatusView.reconcileOutOfBandMoves
		// needs on the next refresh to recognize it as a move rather than a
		// permanent 'remote-only' ghost -- reintroducing the #66 bug for exactly
		// the case that reconciler exists to catch. A genuine, intentional local
		// delete (via the sync panel's own delete action) clears its own
		// metadata directly; an unrelated stale entry left behind by a real
		// delete costs nothing further; detectRename's candidate scan reads it
		// from an already-fetched tree, not a live lookup.

		// Obsidian already knows the exact old path, so record the rename
		// directly instead of reconstructing it later from content/tree
		// comparisons. A file with no sync history yet is just a new file at a
		// new name and needs no tracking.
		//
		// Moving a *folder* fires exactly one 'rename' event, with `file` as
		// the TFolder itself — Obsidian does not also fire one per contained
		// file. Without handling that case, dragging a whole folder tracked
		// nothing at all (the `instanceof TFile` check silently skipped the
		// only event that fired), so no file under it ever showed as moved.
		//
		// Once tracked, also update any open sync panel live -- otherwise the
		// row stays showing its pre-move state (or the old/new path pair as
		// separate rows) until the next manual refresh.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					void this.sync.trackRename(file.path, oldPath).then(() => {
						this.syncStatusRefresh.handleFileRenamed(file, oldPath);
					});
				} else if (file instanceof TFolder) {
					void this.trackFolderRename(file, oldPath);
				}
			})
		);

		// A saved edit inside the configured vault folder should update that
		// row's status live rather than leaving it stale until the next manual
		// refresh. This updates the shared SyncStatusService directly, which
		// republishes to any open Source Control view (and to
		// ChangeRepository) via the subscription set up above; no-op when the
		// file isn't in scope.
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && this.filterPathByVaultFolder(file.path)) {
					void this.syncStatusRefresh.handleFileModified(file);
				}
			})
		);

		// A newly created file inside the configured vault folder should
		// appear as a local-only (`unsynced`) row immediately rather than only
		// after the next manual refresh. Same shared-SyncStatusService path as
		// `modify` above; a later full refresh reconciles it against the remote
		// tree (promoting to `synced`/`modified` if a matching entry exists).
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && this.filterPathByVaultFolder(file.path)) {
					this.syncStatusRefresh.handleFileCreated(file);
				}
			})
		);

		// A local delete inside the configured vault folder reclassifies the
		// row immediately: a previously tracked (`synced`/`modified`) file
		// becomes `local-deleted` (remote still holds it), while a
		// local-only (`unsynced`) or pending-`moved` row simply drops out.
		// This deliberately does NOT clear `syncMetadata` for the path — that
		// evidence is still needed by `reconcileOutOfBandMoves` on the next
		// refresh to recognize an out-of-band move (external tool, cloud sync,
		// mobile) as a rename rather than a permanent `remote-only` ghost (the
		// #66 bug). Only the in-memory status map is updated here; the
		// persisted metadata is untouched, matching the long-standing
		// no-clear-on-delete decision documented above.
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && this.filterPathByVaultFolder(file.path)) {
					this.syncStatusRefresh.handleFileDeleted(file.path);
				}
			})
		);

		this.app.workspace.onLayoutReady(() => {
			// Legacy workspaces may hold more than one persisted sync-status
			// leaf (duplicates accumulated across old plugin versions).
			// Normalize first so startup activation reuses a single canonical
			// leaf instead of revealing one duplicate while others linger.
			this.normalizeSourceControlLeaves();
			if (this.settings.autoRefreshOnStartup) void this.refreshSyncStatusOnStartup();
		});

		await this.checkForUpdateNotice();
	}

	private async refreshSyncStatusOnStartup(): Promise<void> {
		await this.activateSourceControlView();
		await this.sourceControlViewModel.refresh('startup');
	}

	/**
	 * Tracks a folder move as one trackRename call per file now living under
	 * it, computing each file's old path by swapping the folder's new path
	 * prefix for its old one. `vault.getFiles()` walks the whole vault
	 * (including nested subfolders under the moved one), so this covers
	 * arbitrary nesting depth in one pass, same as SyncStatusView's
	 * folder-move grouping later reassembles it into a single row.
	 */
	private async trackFolderRename(folder: TFolder, oldFolderPath: string): Promise<void> {
		const newPrefix = folder.path + '/';
		const oldPrefix = oldFolderPath + '/';
		const files = this.app.vault.getFiles().filter(f => f.path.startsWith(newPrefix));
		for (const file of files) {
			const oldPath = oldPrefix + file.path.slice(newPrefix.length);
			await this.sync.trackRename(file.path, oldPath);
			this.syncStatusRefresh.handleFileRenamed(file, oldPath);
		}
	}

	private async checkForUpdateNotice(): Promise<void> {
		try {
			const currentVersion = this.manifest.version;
			const lastSeen = this.settings.lastSeenVersion;

			// A fresh install has nothing to compare against — just record the
			// current version silently rather than showing a "what's new" tip.
			if (lastSeen && compareVersions(currentVersion, lastSeen) > 0) {
				const newReleases = getUnseenReleases(CHANGELOG, lastSeen);
				if (newReleases.length > 0) {
					new WhatsNewModal(this.app, newReleases, () => void this.activateSourceControlView()).open();
				}
			}

			if (lastSeen !== currentVersion) {
				this.settings.lastSeenVersion = currentVersion;
				await this.saveSettings();
			}
		} catch (e) {
			logger.warn('Failed to check for update notice', e);
		}
	}

	private get serviceName(): string {
		return getServiceName(this.settings);
	}

	// Subscribes to connection status changes, immediately replaying the current
	// status so late subscribers (e.g. the settings tab opened after the initial
	// test already ran) don't have to wait for the next change. Returns an
	// unsubscribe function.
	onConnectionStatusChange(listener: (status: ConnectionStatus) => void): () => void {
		this.connectionStatusListeners.add(listener);
		listener(this.connectionStatus);
		return () => this.connectionStatusListeners.delete(listener);
	}

	private setConnectionStatus(status: ConnectionStatus): void {
		this.connectionStatus = status;
		for (const listener of this.connectionStatusListeners) listener(status);
	}

	// Single source of truth for connection testing, shared by the settings tab
	// badge and the status bar item so both reflect the same in-flight request
	// instead of racing separate calls against the remote API.
	async testConnection(): Promise<ConnectionTestResult> {
		const seq = ++this.connectionTestSeq;
		this.setConnectionStatus({ state: 'checking' });

		try {
			const result = await this.gitService.testConnection(this.settings.branch);
			if (seq !== this.connectionTestSeq) return result;

			if (!result.repoOk) {
				this.setConnectionStatus({ state: 'disconnected', detail: result.error ?? t('settings.testConnection.failed.unreachable') });
			} else if (!result.branchOk) {
				this.setConnectionStatus({ state: 'disconnected', detail: t('settings.testConnection.branchNotFound.badge', { branch: this.settings.branch }) });
			} else {
				this.setConnectionStatus({ state: 'connected' });
			}
			return result;
		} catch (e: unknown) {
			if (seq === this.connectionTestSeq) {
				const message = e instanceof Error ? e.message : String(e);
				this.setConnectionStatus({ state: 'disconnected', detail: message });
			}
			throw e;
		}
	}

	private renderStatusBarConnection(status: ConnectionStatus): void {
		const el = this.statusBarEl;
		if (!el) return;
		el.empty();
		el.removeClass('is-checking', 'is-connected', 'is-disconnected');
		el.addClass(`is-${status.state}`);

		const icons: Record<ConnectionStatusState, string> = {
			checking: 'loader',
			connected: 'check-circle',
			disconnected: 'alert-circle',
		};
		setIcon(el.createSpan({ cls: 'gfs-status-bar-icon' }), icons[status.state]);

		const labels: Record<ConnectionStatusState, string> = {
			checking: t('settings.connectionStatus.checking'),
			connected: t('settings.connectionStatus.connected'),
			disconnected: t('settings.connectionStatus.disconnected'),
		};
		el.createSpan({ text: ` ${this.serviceName}: ${labels[status.state]}` });

		setTooltip(el, status.detail
			? t('settings.connectionStatus.withDetail', { label: labels[status.state], detail: status.detail })
			: labels[status.state]);
	}

	private pushRibbonLabel(): string {
		return Platform.isMobile ? t('main.ribbon.push') : t('main.ribbon.pushTo', { service: this.serviceName });
	}

	// The ribbon icon's tooltip is set once when addRibbonIcon runs, so it goes
	// stale if the user switches Git service afterwards without reloading the
	// plugin. Re-apply it whenever settings are saved to keep it in sync.
	private updateRibbonTooltip(): void {
		if (this.pushRibbonEl) setTooltip(this.pushRibbonEl, this.pushRibbonLabel());
	}

	/**
	 * Ensures concurrent entry points (startup auto refresh, ribbon icon,
	 * command palette, What's New CTA) share one activation run, so two
	 * simultaneous calls can't both pass the "no existing leaf" check and
	 * each create a leaf -- the race that historically produced duplicate
	 * Sync status panes.
	 */
	async activateSourceControlView(): Promise<void> {
		if (this.sourceControlActivation) {
			return this.sourceControlActivation;
		}
		this.sourceControlActivation = this.doActivateSourceControlView();
		try {
			await this.sourceControlActivation;
		} finally {
			this.sourceControlActivation = undefined;
		}
	}

	private async doActivateSourceControlView(): Promise<void> {
		const { workspace } = this.app;

		// Reuse an existing leaf whenever one is present (including the
		// legacy persisted sync-status leaf this view type inherits) instead
		// of creating a second one.
		let leaf = this.normalizeSourceControlLeaves();

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: SOURCE_CONTROL_VIEW_TYPE,
					active: true,
				});
				leaf = rightLeaf;
				// A concurrent activation may have created a leaf while
				// setViewState() was in flight; collapse any duplicates the
				// interleaving produced before revealing.
				leaf = this.normalizeSourceControlLeaves() ?? leaf;
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Legacy layouts may contain more than one persisted `sync-status-view`
	 * leaf (duplicates accumulated across older plugin versions and
	 * activation races). Normalize them to one canonical Source Control leaf:
	 * keep the active leaf if it is one of them, otherwise the first existing
	 * leaf, and detach the rest. Detaching -- not detaching everything and
	 * recreating -- preserves the user's pinned/positioned pane state.
	 * Returns the canonical leaf, or null when none exist.
	 */
	private normalizeSourceControlLeaves(): WorkspaceLeaf | null {
		const leaves = this.app.workspace.getLeavesOfType(SOURCE_CONTROL_VIEW_TYPE);
		if (leaves.length === 0) return null;

		const activeLeaf = this.app.workspace.getActiveViewOfType(SourceControlItemView);
		let canonical = leaves[0];
		if (activeLeaf?.leaf && leaves.includes(activeLeaf.leaf)) {
			canonical = activeLeaf.leaf;
		}
		for (const leaf of leaves) {
			if (leaf !== canonical) leaf.detach();
		}
		return canonical ?? null;
	}

	/**
	 * Shows a change's diff in a main-area tab, which is where a wide
	 * side-by-side view has room to exist -- the Source Control panel lives
	 * in a narrow sidebar. Reuses the single existing diff tab (if any)
	 * rather than opening a new one per file.
	 */
	async openDiffTab(path: string, content: DiffTabContent | null): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(SOURCE_CONTROL_DIFF_VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: SOURCE_CONTROL_DIFF_VIEW_TYPE, active: true });
		}

		const view = leaf.view;
		if (view instanceof DiffTabView) view.setDiff(path, content);
		await workspace.revealLeaf(leaf);
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

		// Fetch the remote tree once and share it with both gitignore discovery
		// and (for push) the SHA-based diff, instead of each fetching it separately.
		let tree: GitTreeEntry[] | undefined;
		try {
			tree = await this.gitService.listFilesDetailed(this.settings.branch, false);
		} catch (e) {
			logger.warn('Failed to fetch remote tree; falling back to per-call fetches', e);
		}

		await this.gitignoreManager.loadGitignores(tree);
		const files = allPaths.filter(p => !this.gitignoreManager.isIgnored(this.getNormalizedPath(p)));

		if (files.length === 0) {
			new Notice(t('main.notice.noFilesToRun', { op: op === 'push' ? t('main.op.push') : t('main.op.pull') }));
			return;
		}

		const msg = op === 'push'
			? t('main.confirm.pushAll', { count: files.length, service: this.serviceName })
			: t('main.confirm.pullAll', { count: files.length, service: this.serviceName });

		const confirmed = await this.showConfirmDialog(msg);
		if (!confirmed) return;

		const runVerb = op === 'push' ? t('main.verb.pushing') : t('main.verb.pulling');
		const progressNotice = new Notice(t('main.progress.running', { verb: runVerb, total: files.length }), 0);

		try {
			const results = op === 'push'
				? await this.sync.pushFiles(files, (current, total, fileName) => {
					progressNotice.setMessage(t('main.progress.step', { verb: t('main.verb.pushing'), current, total, fileName }));
				}, tree)
				: await this.sync.pullAllFiles(files, (current, total, fileName) => {
					progressNotice.setMessage(t('main.progress.step', { verb: t('main.verb.pulling'), current, total, fileName }));
				}, tree);

			progressNotice.hide();

			if (results.errors.length > 0) {
				logger.error(`${op} errors:`, results.errors);
			}
		} catch (e) {
			progressNotice.hide();
			logger.error(String(e));
			const failVerb = op === 'push' ? t('main.verb.push') : t('main.verb.pull');
			new Notice(t('main.notice.runFailed', { verb: failVerb, message: e instanceof Error ? e.message : String(e) }));
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

	private updateGitignoreManager(): void {
		const configKey = JSON.stringify([
			this.settings.branch,
			this.settings.rootPath,
			this.settings.vaultFolder,
			this.settings.ignorePatterns,
		]);
		if (this.gitignoreConfigKey === configKey) return;
		this.gitignoreManager = new GitignoreManager(
			this.app,
			this.gitService,
			this.settings.branch,
			this.settings.rootPath,
			this.settings.vaultFolder,
			this.settings.ignorePatterns,
		);
		this.gitignoreConfigKey = configKey;
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
		// Cleanup of registered components (views, commands, DOM/vault event
		// listeners) is handled by Obsidian. The ChangeRepository subscription
		// isn't Obsidian-managed, so it's unsubscribed explicitly.
		this.unsubscribeChangeRepository?.();
		this.unsubscribeChangeRepository = undefined;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<GitLabFilesPushSettings>);
		setLanguageOverride(this.settings.language);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.initializeGitService();
		this.updateGitignoreManager();
		this.updateRibbonTooltip();
	}
}
