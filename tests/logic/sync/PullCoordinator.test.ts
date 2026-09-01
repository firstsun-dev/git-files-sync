import { describe, expect, it, vi } from 'vitest';
import { PullCoordinator, type PullCoordinatorDependencies } from '../../../src/logic/sync/PullCoordinator';
import { gitBlobSha } from '../../../src/utils/git-blob-sha';
import type { GitFile } from '../../../src/services/git-service-interface';
import type { GitLabFilesPushSettings } from '../../../src/settings';

function buildDependencies(overrides: Partial<PullCoordinatorDependencies> = {}): PullCoordinatorDependencies {
    const settings = {
        serviceType: 'gitlab',
        syncMetadata: {},
        branch: 'main',
        vaultFolder: '',
        rootPath: '',
    } as unknown as GitLabFilesPushSettings;

    return {
        gitService: () => ({}) as never,
        settings,
        scanner: {
            fileInfo: (fileOrPath: string) => ({ path: fileOrPath, name: fileOrPath, isString: true }),
            toRepoPath: (path: string) => path,
            toTreePath: (path: string) => path,
            pathExists: vi.fn().mockResolvedValue(false),
            indexedFileExists: vi.fn().mockReturnValue(false),
            readContent: vi.fn().mockResolvedValue(''),
        } as unknown as PullCoordinatorDependencies['scanner'],
        executor: { pull: vi.fn().mockResolvedValue(undefined) } as unknown as PullCoordinatorDependencies['executor'],
        confirmPlan: vi.fn().mockResolvedValue(true),
        updateMetadata: vi.fn().mockResolvedValue(undefined),
        migrateBaseline: vi.fn().mockResolvedValue(undefined),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        notify: vi.fn(),
        serviceName: () => 'GitLab',
        ...overrides,
    };
}

describe('PullCoordinator.planSingleFile', () => {
    it('plans an addition when the file does not exist locally', async () => {
        const deps = buildDependencies();
        const coordinator = new PullCoordinator(deps);
        const remote: GitFile = { content: 'remote content', sha: 'remote-sha' };

        const decision = await coordinator.planSingleFile('new.md', remote);

        expect(decision.action).toBe('pull-create');
    });

    it('plans none (already up to date) once local content and baseline match the remote blob', async () => {
        const localContent = 'same content';
        const sha = await gitBlobSha(localContent);
        const deps = buildDependencies({
            settings: {
                serviceType: 'gitlab',
                syncMetadata: { 'a.md': { lastSyncedSha: sha, lastSyncedAt: 0 } },
                branch: 'main',
                vaultFolder: '',
                rootPath: '',
            } as unknown as GitLabFilesPushSettings,
            scanner: {
                fileInfo: (fileOrPath: string) => ({ path: fileOrPath, name: fileOrPath, isString: true }),
                toRepoPath: (path: string) => path,
                toTreePath: (path: string) => path,
                pathExists: vi.fn().mockResolvedValue(true),
                indexedFileExists: vi.fn().mockReturnValue(true),
                readContent: vi.fn().mockResolvedValue(localContent),
            } as unknown as PullCoordinatorDependencies['scanner'],
        });
        const coordinator = new PullCoordinator(deps);
        const remote: GitFile = { content: localContent, sha };

        const decision = await coordinator.planSingleFile('a.md', remote);

        expect(decision.action).toBe('none');
    });

    it('resolves a legacy GitLab baseline keyed by revision, the same correction SyncManager.pullFile() used to duplicate', async () => {
        // Old GitLab metadata stored the file's `revision` (last_commit_id) as
        // lastSyncedSha rather than a blob sha. When the current remote fetch's
        // revision still matches that stored value, the true baseline blob is
        // the remote's own current sha -- so an unmodified file classifies as
        // 'none', not a false-positive conflict/modification.
        const content = 'unchanged content';
        const sha = await gitBlobSha(content);
        const legacyRevision = 'legacy-commit-id';
        const deps = buildDependencies({
            settings: {
                serviceType: 'gitlab',
                syncMetadata: { 'a.md': { lastSyncedSha: legacyRevision, lastSyncedAt: 0 } },
                branch: 'main',
                vaultFolder: '',
                rootPath: '',
            } as unknown as GitLabFilesPushSettings,
            scanner: {
                fileInfo: (fileOrPath: string) => ({ path: fileOrPath, name: fileOrPath, isString: true }),
                toRepoPath: (path: string) => path,
                toTreePath: (path: string) => path,
                pathExists: vi.fn().mockResolvedValue(true),
                indexedFileExists: vi.fn().mockReturnValue(true),
                readContent: vi.fn().mockResolvedValue(content),
            } as unknown as PullCoordinatorDependencies['scanner'],
        });
        const coordinator = new PullCoordinator(deps);
        const remote: GitFile = { content, sha, revision: legacyRevision };

        const decision = await coordinator.planSingleFile('a.md', remote);

        expect(decision.action).toBe('none');
    });

    it('plans resolve-conflict when both sides changed since the baseline', async () => {
        const deps = buildDependencies({
            settings: {
                serviceType: 'gitlab',
                syncMetadata: { 'a.md': { lastSyncedSha: 'base-sha', lastSyncedAt: 0 } },
                branch: 'main',
                vaultFolder: '',
                rootPath: '',
            } as unknown as GitLabFilesPushSettings,
            scanner: {
                fileInfo: (fileOrPath: string) => ({ path: fileOrPath, name: fileOrPath, isString: true }),
                toRepoPath: (path: string) => path,
                toTreePath: (path: string) => path,
                pathExists: vi.fn().mockResolvedValue(true),
                indexedFileExists: vi.fn().mockReturnValue(true),
                readContent: vi.fn().mockResolvedValue('local edit'),
            } as unknown as PullCoordinatorDependencies['scanner'],
        });
        const coordinator = new PullCoordinator(deps);
        const remote: GitFile = { content: 'remote edit', sha: 'remote-sha' };

        const decision = await coordinator.planSingleFile('a.md', remote);

        expect(decision.action).toBe('resolve-conflict');
    });
});
