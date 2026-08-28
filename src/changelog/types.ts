import { type LanguageSetting } from '../i18n';

/** Per-locale text for a single changelog entry. `en` is required as the fallback; other locales are optional. */
export type ChangelogEntryText = { en: string } & Partial<Record<Exclude<LanguageSetting, 'system' | 'en'>, string>>;

export interface ChangelogEntry {
    text: ChangelogEntryText;
    notable?: boolean;
}

export interface ChangelogStep {
    title: ChangelogEntryText;
    description?: ChangelogEntryText;
}

/** Action a modal's primary CTA can trigger, beyond just closing. */
export type ChangelogAction = 'open-source-control';

/** Guides a user through a changed mental model, shown above the regular entry list. */
export interface ChangelogOnboarding {
    steps: ChangelogStep[];
    action?: ChangelogAction;
}

export interface ChangelogRelease {
    version: string;

    /** Short mental-model summary shown above the entry list, e.g. "A new Source Control workflow". Omitted for ordinary releases. */
    headline?: ChangelogEntryText;
    summary?: ChangelogEntryText;

    onboarding?: ChangelogOnboarding;

    entries: ChangelogEntry[];
}
