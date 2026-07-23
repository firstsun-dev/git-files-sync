import { type LanguageSetting } from '../i18n';

/** Per-locale text for a single changelog entry. `en` is required as the fallback; other locales are optional. */
export type ChangelogEntryText = { en: string } & Partial<Record<Exclude<LanguageSetting, 'system' | 'en'>, string>>;

export interface ChangelogEntry {
    text: ChangelogEntryText;
    notable?: boolean;
}

export interface ChangelogRelease {
    version: string;
    entries: ChangelogEntry[];
}
