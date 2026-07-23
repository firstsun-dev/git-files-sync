import { compareVersions } from '../utils/version';
import { getActiveLocale } from '../i18n';
import { type ChangelogEntry, type ChangelogEntryText, type ChangelogRelease } from './types';
import { release as release_1_3_1 } from './1.3.1';
import { release as release_1_3_0 } from './1.3.0';
import { release as release_1_2_1 } from './1.2.1';

export { type ChangelogEntry, type ChangelogEntryText, type ChangelogRelease } from './types';

/**
 * Hand-curated, user-facing highlights shown in the "what's new" modal after an
 * update. Distinct from the auto-generated CHANGELOG.md (which lists every
 * commit for developers) — keep entries short and skimmable, and mark the ones
 * worth calling out as `notable` so they aren't buried among minor fixes.
 *
 * Each release's entries live in their own `./<version>/` folder (in the
 * `text` field's own locale strings, not the shared i18n catalog) so cutting a
 * release only ever adds a new folder here instead of growing the shared
 * locale files forever. Versions are matched against manifest.json's version
 * by exact string, so keep them in sync.
 */
export const CHANGELOG: ChangelogRelease[] = [release_1_3_1, release_1_3_0, release_1_2_1];

/** Resolves an entry's text for the active UI locale, falling back to English. */
export function entryText(entry: ChangelogEntry): string {
    const locale = getActiveLocale() as keyof ChangelogEntryText;
    return entry.text[locale] ?? entry.text.en;
}

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
