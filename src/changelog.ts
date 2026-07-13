import { compareVersions } from './utils/version';

/**
 * Hand-curated, user-facing highlights shown in the "what's new" modal after an
 * update. Distinct from the auto-generated CHANGELOG.md (which lists every
 * commit for developers) — keep entries short and skimmable, and mark the ones
 * worth calling out as `notable` so they aren't buried among minor fixes.
 *
 * Add an entry here as part of cutting a release; versions are matched against
 * manifest.json's version by exact string, so keep them in sync.
 */
export interface ChangelogEntry {
    text: string;
    notable?: boolean;
}

export interface ChangelogRelease {
    version: string;
    entries: ChangelogEntry[];
}

export const CHANGELOG: ChangelogRelease[] = [
    {
        version: '1.2.1',
        entries: [
            { text: 'Fixed compatibility with Obsidian versions back to 1.11.0', notable: true },
        ],
    },
];

/**
 * Releases newer than `lastSeenVersion`, newest first — what a "what's new"
 * modal should show after an update. Returns everything (unsorted by recency
 * concerns) when `lastSeenVersion` is empty, since callers are expected to
 * only invoke this once they've already decided an upgrade happened.
 */
export function getUnseenReleases(changelog: ChangelogRelease[], lastSeenVersion: string): ChangelogRelease[] {
    return changelog
        .filter(release => compareVersions(release.version, lastSeenVersion) > 0)
        .sort((a, b) => compareVersions(b.version, a.version));
}
