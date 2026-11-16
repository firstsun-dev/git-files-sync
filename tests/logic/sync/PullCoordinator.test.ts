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

describe('PullCoordinator.applyPullBatch requireBaseline (unattended pulls)', () => {
    async function setup(options: { local: string[]; remote: string; baseline?: string; treeSha?: string }) {
        const remoteSha = await gitBlobSha(options.remote);
        const reads = [...options.local];
        const pull = vi.fn().mockResolvedValue(undefined);
        const deps = buildDependencies({
            gitService: () => ({ getFile: vi.fn().mockResolvedValue({ content: options.remote, sha: remoteSha }) }) as never,
            settings: {
                serviceType: 'github',
                syncMetadata: options.baseline === undefined ? {} : { 'a.md': { lastSyncedSha: options.baseline, lastSyncedAt: 0 } },
                branch: 'main',
                vaultFolder: '',
                rootPath: '',
            } as unknown as GitLabFilesPushSettings,
            scanner: {
                fileInfo: (path: string) => ({ path, name: path, isString: true }),
                toRepoPath: (path: string) => path,
                toTreePath: (path: string) => path,
                pathExists: vi.fn().mockResolvedValue(true),
                indexedFileExists: vi.fn().mockReturnValue(true),
                // Each read pops the next local snapshot (last one repeats), so a test can
                // model the file being edited between the tree check and the write.
                readContent: vi.fn().mockImplementation(async () => (reads.length > 1 ? reads.shift() : reads[0])),
            } as unknown as PullCoordinatorDependencies['scanner'],
            executor: { pull } as unknown as PullCoordinatorDependencies['executor'],
        });
        const tree = [{ path: 'a.md', symlink: false, sha: options.treeSha ?? remoteSha }];
        return { coordinator: new PullCoordinator(deps), pull, tree };
    }

    it('does not overwrite differing local content that has no baseline', async () => {
        const { coordinator, pull, tree } = await setup({ local: ['my unsynced edit'], remote: 'remote text' });

        const result = await coordinator.applyPullBatch(['a.md'], undefined, tree, { notify: false, requireBaseline: true });

        expect(pull).not.toHaveBeenCalled();
        expect(result.conflicts).toBe(1);
    });

    it('does not overwrite a local file edited after the refresh classified it as remote-modified', async () => {
        const baseline = await gitBlobSha('baseline text');
        const { coordinator, pull, tree } = await setup({ local: ['edited after refresh'], remote: 'baseline text', baseline });

        const result = await coordinator.applyPullBatch(['a.md'], undefined, tree, { notify: false, requireBaseline: true });

        expect(pull).not.toHaveBeenCalled();
        expect(result.conflicts).toBe(1);
    });

    it('re-checks the local file after fetching remote content, catching an edit made in between', async () => {
        const baseline = await gitBlobSha('baseline text');
        // First read (tree check): still the baseline. Second read (after remote fetch): edited.
        const { coordinator, pull, tree } = await setup({
            local: ['baseline text', 'edited while fetching'],
            remote: 'remote update',
            baseline,
        });

        const result = await coordinator.applyPullBatch(['a.md'], undefined, tree, { notify: false, requireBaseline: true });

        expect(pull).not.toHaveBeenCalled();
        expect(result.conflicts).toBe(1);
    });

    it('still pulls a genuine remote change over an unmodified local file', async () => {
        const baseline = await gitBlobSha('baseline text');
        const { coordinator, pull, tree } = await setup({ local: ['baseline text'], remote: 'remote update', baseline });

        const result = await coordinator.applyPullBatch(['a.md'], undefined, tree, { notify: false, requireBaseline: true });

        expect(pull).toHaveBeenCalledOnce();
        expect(result.updated).toBe(1);
    });

    it('keeps the interactive/manual behavior: no baseline still overwrites after confirmation', async () => {
        const { coordinator, pull, tree } = await setup({ local: ['my unsynced edit'], remote: 'remote text' });

        const result = await coordinator.applyPullBatch(['a.md'], undefined, tree, { notify: false });

        expect(pull).toHaveBeenCalledOnce();
        expect(result.updated).toBe(1);
    });
});
