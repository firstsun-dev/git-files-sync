import { describe, it, expect } from 'vitest';
import { getUnseenReleases, type ChangelogRelease } from '../src/changelog';

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
