import { vi, Mocked } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';
import { App, DataAdapter } from 'obsidian';
import { GitLabFilesPushSettings } from '../../src/settings';
import { GitServiceInterface } from '../../src/services/git-service-interface';

export interface SyncManagerMocks {
    manager: SyncManager;
    mockApp: Mocked<App>;
    mockGitService: Mocked<GitServiceInterface>;
    mockAdapter: Mocked<DataAdapter>;
    mockSettings: GitLabFilesPushSettings;
}

export function createSyncManagerMocks(): SyncManagerMocks {
    const mockAdapter = {
        exists: vi.fn(),
        read: vi.fn(),
        write: vi.fn(),
        readBinary: vi.fn(),
        writeBinary: vi.fn(),
        mkdir: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<DataAdapter>;

    const mockApp = {
        vault: {
            read: vi.fn(),
            readBinary: vi.fn(),
            modify: vi.fn(),
            modifyBinary: vi.fn(),
            getFileByPath: vi.fn().mockReturnValue(null),
            adapter: mockAdapter,
        },
    } as unknown as Mocked<App>;

    const mockGitService = {
        pushFile: vi.fn(),
        getFile: vi.fn(),
        testConnection: vi.fn(),
        listFiles: vi.fn(),
        listFilesDetailed: vi.fn().mockResolvedValue([]),
        deleteFile: vi.fn(),
        getRepoGitignores: vi.fn(),
        updateConfig: vi.fn(),
    } as unknown as Mocked<GitServiceInterface>;

    const mockSettings = {
        serviceType: 'github',
        githubToken: 'token',
        githubOwner: 'owner',
        githubRepo: 'repo',
        branch: 'main',
        syncMetadata: {},
        vaultFolder: '',
        rootPath: '',
    } as unknown as GitLabFilesPushSettings;

    const manager = new SyncManager(mockApp, mockGitService, mockSettings);
    // @ts-ignore - accessing private for test
    manager.saveSettings = vi.fn().mockResolvedValue(undefined);

    return { manager, mockApp, mockGitService, mockAdapter, mockSettings };
}

export const makeBuf = (bytes: number[]) => new Uint8Array(bytes).buffer;
