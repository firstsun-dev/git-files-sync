import type { GitLabFilesPushSettings, SymlinkHandling, SyncMetadata } from './model';

/**
 * Metadata written before `lastKnownPath` was introduced used its record key
 * as the path. Keep that format eligible for rename reconciliation.
 */
export function isSyncMetadataAtPath(metadata: SyncMetadata | undefined, path: string): metadata is SyncMetadata {
    return metadata !== undefined && (metadata.lastKnownPath === undefined || metadata.lastKnownPath === path);
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
