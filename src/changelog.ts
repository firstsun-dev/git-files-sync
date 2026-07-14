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
        version: '1.3.0',
        entries: [
            { text: 'The plugin now speaks multiple languages — English, Traditional Chinese, and Simplified Chinese. It follows your Obsidian display language automatically, or you can pick one in Settings.', notable: true },
            { text: 'Checking sync status is now much faster, especially in vaults with lots of files.', notable: true },
            { text: 'Fixed a bug where a linked (symlinked) folder could be pulled incorrectly instead of being treated as a link.' },
            { text: 'Added a setting to keep specific files or folders out of sync, in addition to what your repo\'s .gitignore already excludes.' },
            { text: 'Settings now show your connection status at a glance, so you can tell right away if something needs attention.' },
            { text: 'The conflict resolution window can now be resized to see more content at once.' },
            { text: 'Picking your sync folders is easier now, with a folder browser instead of typing paths by hand.' },
            { text: 'Connection errors now explain what went wrong in plain language instead of a raw technical error.' },
            { text: 'You\'ll now see a short "what\'s new" summary right after updating, so you don\'t miss new features.' },
        ],
    },
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
