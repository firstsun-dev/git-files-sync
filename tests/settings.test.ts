import { describe, expect, it } from 'vitest';
import * as settingsCompat from '../src/settings';
import * as settingsModel from '../src/settings/model';
import * as settingsHelpers from '../src/settings/helpers';

describe('settings module split', () => {
    it('re-exports the model and helpers from src/settings.ts unchanged', () => {
        expect(settingsCompat.DEFAULT_SETTINGS).toBe(settingsModel.DEFAULT_SETTINGS);
        expect(settingsCompat.getServiceName).toBe(settingsHelpers.getServiceName);
        expect(settingsCompat.getEffectiveSymlinkHandling).toBe(settingsHelpers.getEffectiveSymlinkHandling);
        expect(settingsCompat.isSyncMetadataAtPath).toBe(settingsHelpers.isSyncMetadataAtPath);
    });

    it('keeps DEFAULT_SETTINGS shape/values unchanged by the split', () => {
        expect(settingsModel.DEFAULT_SETTINGS).toEqual({
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
            automaticSyncEnabled: false,
            automaticSyncIntervalMinutes: 5,
            automaticSyncOnStartup: false,
        });
    });

    it('defaults automatic sync to OFF, 5 minutes, and startup sync OFF', () => {
        expect(settingsModel.DEFAULT_SETTINGS.automaticSyncEnabled).toBe(false);
        expect(settingsModel.DEFAULT_SETTINGS.automaticSyncIntervalMinutes).toBe(5);
        expect(settingsModel.DEFAULT_SETTINGS.automaticSyncOnStartup).toBe(false);
    });

    it('merges older stored settings with the new automatic-sync defaults', () => {
        // A settings object persisted before automatic sync existed.
        const stored = { gitlabToken: 'abc', branch: 'develop' } as Partial<typeof settingsModel.DEFAULT_SETTINGS>;
        const merged = { ...settingsModel.DEFAULT_SETTINGS, ...stored };
        expect(merged.automaticSyncEnabled).toBe(false);
        expect(merged.automaticSyncIntervalMinutes).toBe(5);
        expect(merged.automaticSyncOnStartup).toBe(false);
        expect(merged.branch).toBe('develop');
    });
});

describe('normalizeAutomaticSyncIntervalMinutes', () => {
    const fallback = settingsModel.DEFAULT_SETTINGS.automaticSyncIntervalMinutes;

    it('accepts a finite interval at or above the minimum', () => {
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes(1, fallback)).toBe(1);
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes(45, fallback)).toBe(45);
    });

    it('floors fractional minute values', () => {
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes(2.9, fallback)).toBe(2);
    });

    it('rejects zero, negative, NaN, Infinity, and non-numeric input so no rapid timer can be created', () => {
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes(0, fallback)).toBe(fallback);
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes(-5, fallback)).toBe(fallback);
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes(Number.NaN, fallback)).toBe(fallback);
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes(Number.POSITIVE_INFINITY, fallback)).toBe(fallback);
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes('nonsense', fallback)).toBe(fallback);
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes(undefined, fallback)).toBe(fallback);
    });

    it('parses a numeric string from older storage', () => {
        expect(settingsHelpers.normalizeAutomaticSyncIntervalMinutes('10', fallback)).toBe(10);
    });

    it('getServiceName still maps every GitServiceType to its display name', () => {
        expect(settingsHelpers.getServiceName({ ...settingsModel.DEFAULT_SETTINGS, serviceType: 'gitlab' })).toBe('GitLab');
        expect(settingsHelpers.getServiceName({ ...settingsModel.DEFAULT_SETTINGS, serviceType: 'github' })).toBe('GitHub');
        expect(settingsHelpers.getServiceName({ ...settingsModel.DEFAULT_SETTINGS, serviceType: 'gitea' })).toBe('Gitea');
    });

    it('getEffectiveSymlinkHandling still downgrades "real" to "skip" on non-GitHub providers', () => {
        const base = { ...settingsModel.DEFAULT_SETTINGS, symlinkHandling: 'real' as const };
        expect(settingsHelpers.getEffectiveSymlinkHandling({ ...base, serviceType: 'github' })).toBe('real');
        expect(settingsHelpers.getEffectiveSymlinkHandling({ ...base, serviceType: 'gitlab' })).toBe('skip');
        expect(settingsHelpers.getEffectiveSymlinkHandling({ ...base, serviceType: 'gitea' })).toBe('skip');
    });

    it('isSyncMetadataAtPath still accepts legacy (keyed-by-path, no lastKnownPath) metadata', () => {
        expect(settingsHelpers.isSyncMetadataAtPath({ lastSyncedSha: 'sha', lastSyncedAt: 0 }, 'a.md')).toBe(true);
        expect(settingsHelpers.isSyncMetadataAtPath({ lastSyncedSha: 'sha', lastSyncedAt: 0, lastKnownPath: 'b.md' }, 'a.md')).toBe(false);
        expect(settingsHelpers.isSyncMetadataAtPath(undefined, 'a.md')).toBe(false);
    });
});
