import { describe, it, expect } from 'vitest';
import { buildRemoteFileUrl } from '../../src/utils/remote-url';
import type { GitLabFilesPushSettings } from '../../src/settings';

function settings(overrides: Partial<GitLabFilesPushSettings> = {}): GitLabFilesPushSettings {
    return {
        serviceType: 'github',
        gitlabToken: '', gitlabBaseUrl: 'https://gitlab.com', projectId: '',
        githubToken: '', githubOwner: 'firstsun-dev', githubRepo: 'git-files-sync',
        giteaToken: '', giteaBaseUrl: '', giteaOwner: '', giteaRepo: '',
        branch: 'main', syncMetadata: {}, rootPath: '', vaultFolder: '',
        symlinkHandling: 'follow', ignorePatterns: '',
        lastSeenVersion: '', bannerDismissedVersion: '', language: 'en',
        ...overrides,
    } as GitLabFilesPushSettings;
}

describe('buildRemoteFileUrl', () => {
    it('builds a GitHub blob URL', () => {
        expect(buildRemoteFileUrl(settings(), 'notes/todo.md'))
            .toBe('https://github.com/firstsun-dev/git-files-sync/blob/main/notes/todo.md');
    });

    it('applies rootPath', () => {
        expect(buildRemoteFileUrl(settings({ rootPath: 'vault' }), 'notes/todo.md'))
            .toBe('https://github.com/firstsun-dev/git-files-sync/blob/main/vault/notes/todo.md');
    });

    it('does not double-apply a rootPath the path already carries', () => {
        expect(buildRemoteFileUrl(settings({ rootPath: 'vault' }), 'vault/notes/todo.md'))
            .toBe('https://github.com/firstsun-dev/git-files-sync/blob/main/vault/notes/todo.md');
    });

    it('encodes each path segment but keeps the separators', () => {
        expect(buildRemoteFileUrl(settings(), 'my notes/a b&c.md'))
            .toBe('https://github.com/firstsun-dev/git-files-sync/blob/main/my%20notes/a%20b%26c.md');
    });

    it('encodes the branch name', () => {
        expect(buildRemoteFileUrl(settings({ branch: 'feat/thing' }), 'a.md'))
            .toBe('https://github.com/firstsun-dev/git-files-sync/blob/feat%2Fthing/a.md');
    });

    it('builds a Gitea URL and trims the base URL slash', () => {
        const s = settings({
            serviceType: 'gitea', giteaBaseUrl: 'https://git.example.com/',
            giteaOwner: 'me', giteaRepo: 'notes',
        });
        expect(buildRemoteFileUrl(s, 'a/b.md')).toBe('https://git.example.com/me/notes/src/branch/main/a/b.md');
    });

    it('builds a GitLab URL from a namespace-path project id', () => {
        const s = settings({ serviceType: 'gitlab', projectId: 'group/sub/project' });
        expect(buildRemoteFileUrl(s, 'a.md')).toBe('https://gitlab.com/group/sub/project/-/blob/main/a.md');
    });

    // A numeric project id — which is what the setting documents — has no
    // derivable per-file web URL, and a link that 404s is worse than none.
    it('returns null for a numeric GitLab project id', () => {
        expect(buildRemoteFileUrl(settings({ serviceType: 'gitlab', projectId: '12345678' }), 'a.md')).toBeNull();
    });

    it.each([
        ['github without an owner', { githubOwner: '' }],
        ['github without a repo',   { githubRepo: '' }],
    ])('returns null for %s', (_label, overrides) => {
        expect(buildRemoteFileUrl(settings(overrides), 'a.md')).toBeNull();
    });

    it('returns null for gitea without a base URL', () => {
        const s = settings({ serviceType: 'gitea', giteaOwner: 'me', giteaRepo: 'notes', giteaBaseUrl: '' });
        expect(buildRemoteFileUrl(s, 'a.md')).toBeNull();
    });

    it('returns null for an empty path', () => {
        expect(buildRemoteFileUrl(settings(), '')).toBeNull();
    });
});
