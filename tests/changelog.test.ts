import { describe, it, expect } from 'vitest';
import { CHANGELOG, getUnseenReleases, type ChangelogRelease } from '../src/changelog';

describe('getUnseenReleases', () => {
    const changelog: ChangelogRelease[] = [
        { version: '1.0.0', entries: [{ text: { en: 'Initial release' } }] },
        { version: '1.1.0', entries: [{ text: { en: 'Feature A' } }] },
        { version: '1.2.0', entries: [{ text: { en: 'Feature B' }, notable: true }] },
        { version: '1.10.0', entries: [{ text: { en: 'Feature C' } }] },
    ];

    it('returns only releases newer than lastSeenVersion', () => {
        const result = getUnseenReleases(changelog, '1.1.0');
        expect(result.map(r => r.version)).toEqual(['1.10.0', '1.2.0']);
    });

    it('returns releases newest-first', () => {
        const result = getUnseenReleases(changelog, '1.0.0');
        expect(result.map(r => r.version)).toEqual(['1.10.0', '1.2.0', '1.1.0']);
    });

    it('compares versions numerically, not lexically (1.10.0 > 1.2.0)', () => {
        const result = getUnseenReleases(changelog, '1.9.0');
        expect(result.map(r => r.version)).toEqual(['1.10.0']);
    });

    it('returns an empty array when already on the latest version', () => {
        expect(getUnseenReleases(changelog, '1.10.0')).toEqual([]);
    });

    it('returns everything when lastSeenVersion is empty', () => {
        expect(getUnseenReleases(changelog, '').length).toBe(4);
    });
});

describe('1.5.0 release notes', () => {
    it('provides all six highlights in every supported language', () => {
        const release = CHANGELOG.find(entry => entry.version === '1.5.0');

        expect(release?.entries).toHaveLength(6);
        for (const entry of release?.entries ?? []) {
            expect(entry.text.en).toBeTruthy();
            expect(entry.text['zh-tw']).toBeTruthy();
            expect(entry.text['zh-cn']).toBeTruthy();
        }
    });
});
