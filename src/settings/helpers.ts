import type { GitLabFilesPushSettings, SymlinkHandling, SyncMetadata } from './model';

/**
 * Smallest interval an automatic sync may be scheduled for, in minutes. The
 * settings UI also clamps to this, but the scheduler resolves through this
 * helper as well so an invalid persisted value (0, negative, NaN, a stray
 * string from older data) can never produce a tight/zero-interval timer.
 */
export const MIN_AUTOMATIC_SYNC_INTERVAL_MINUTES = 1;

/**
 * Coerces a stored/typed automatic-sync interval to a valid minute count.
 * Non-finite, non-numeric, or below the minimum values fall back to the
 * default, so older settings that predate this field (or hand-edited data)
 * can never create a rapid/zero-delay timer.
 */
export function normalizeAutomaticSyncIntervalMinutes(
    value: unknown,
    fallback: number,
): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < MIN_AUTOMATIC_SYNC_INTERVAL_MINUTES) return fallback;
    return Math.floor(parsed);
}

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
