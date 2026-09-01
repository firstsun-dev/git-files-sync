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
        });
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
