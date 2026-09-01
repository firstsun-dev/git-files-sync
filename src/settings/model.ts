import type { LanguageSetting } from '../i18n';

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
    /** Refresh the sync status automatically after Obsidian finishes loading. */
    autoRefreshOnStartup: boolean;
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
    rootPath: '',
    branch: 'main',
    syncMetadata: {},
    vaultFolder: '',
    symlinkHandling: 'real',
    ignorePatterns: '',
    lastSeenVersion: '',
    bannerDismissedVersion: '',
    language: 'system',
    autoRefreshOnStartup: true,
};
