/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { GitignoreManager } from '../../src/logic/gitignore-manager';
import { App, DataAdapter } from 'obsidian';
import { GitServiceInterface } from '../../src/services/git-service-interface';

vi.mock('obsidian');

describe('GitignoreManager', () => {
    let manager: GitignoreManager;
    let mockApp: Mocked<App>;
    let mockGitService: Mocked<GitServiceInterface>;
    const branch = 'main';

    beforeEach(() => {
        vi.clearAllMocks();

        const mockAdapter = {
            exists: vi.fn(),
            read: vi.fn(),
        } as unknown as Mocked<DataAdapter>;

        mockApp = {
            vault: {
                adapter: mockAdapter,
            }
        } as unknown as Mocked<App>;

        mockGitService = {
            getRepoGitignores: vi.fn(),
            getFile: vi.fn(),
        } as unknown as Mocked<GitServiceInterface>;

        // Start with empty rootPath for simple unit tests
        manager = new GitignoreManager(mockApp, mockGitService, branch, '');
    });

    describe('loadGitignores', () => {
        it('should load root gitignore from local if it exists', async () => {
            vi.mocked(mockGitService.getRepoGitignores).mockResolvedValue(['.gitignore']);
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('node_modules/\n*.log');

            await manager.loadGitignores();

            expect(adapter.read).toHaveBeenCalledWith('.gitignore');
            expect(manager.isIgnored('node_modules/test.js')).toBe(true);
            expect(manager.isIgnored('test.log')).toBe(true);
            expect(manager.isIgnored('src/main.ts')).toBe(false);
        });

        it('should load gitignores from remote as fallback', async () => {
            vi.mocked(mockGitService.getRepoGitignores).mockResolvedValue(['.gitignore']);
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(false);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'secret.txt', sha: 'sha' });

            await manager.loadGitignores();

            expect(mockGitService.getFile).toHaveBeenCalledWith('/.gitignore', branch);
            expect(manager.isIgnored('secret.txt')).toBe(true);
        });

        it('should handle subdirectory gitignores correctly', async () => {
            // Repo structure:
            // .gitignore
            // sub/.gitignore
            vi.mocked(mockGitService.getRepoGitignores).mockResolvedValue(['.gitignore', 'sub/.gitignore']);
            
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation((path) => {
                if (path === '.gitignore') return Promise.resolve('root-ignored.txt');
                if (path === 'sub/.gitignore') return Promise.resolve('*.tmp');
                return Promise.resolve('');
            });

            await manager.loadGitignores();

            // Should ignore sub/test.tmp (from sub/.gitignore)
            expect(manager.isIgnored('sub/test.tmp')).toBe(true);
            // Should NOT ignore top-level test.tmp (sub/.gitignore only applies to sub/)
            expect(manager.isIgnored('test.tmp')).toBe(false);
            // Should ignore root-ignored.txt (from root .gitignore)
            expect(manager.isIgnored('root-ignored.txt')).toBe(true);
            // Should ignore sub/root-ignored.txt (root .gitignore applies to subfolders too)
            expect(manager.isIgnored('sub/root-ignored.txt')).toBe(true);
        });
    });

    describe('isIgnored with rootPath (vault is subdirectory)', () => {
        beforeEach(async () => {
            // Repo structure:
            // .gitignore (contains 'dist/')
            // vault/ (Obsidian vault root)
            //   .gitignore (contains '*.tmp')
            //   src/
            
            manager = new GitignoreManager(mockApp, mockGitService, branch, 'vault');
            vi.mocked(mockGitService.getRepoGitignores).mockResolvedValue(['.gitignore', 'vault/.gitignore']);
            
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockImplementation((path) => Promise.resolve(path === '.gitignore' || path === '.gitignore')); // Wait, local paths are relative to vault/
            
            // For '.gitignore' (repo root), it's NOT in vault, so adapter.exists('.gitignore') is false
            vi.mocked(adapter.exists).mockImplementation((path) => Promise.resolve(path === '.gitignore')); // This is vault/.gitignore
            
            vi.mocked(mockGitService.getFile).mockImplementation((path) => {
                if (path === '/.gitignore') return Promise.resolve({ content: 'dist/', sha: '1' });
                return Promise.resolve({ content: '', sha: '' });
            });
            vi.mocked(adapter.read).mockImplementation((path) => {
                if (path === '.gitignore') return Promise.resolve('*.tmp');
                return Promise.resolve('');
            });

            await manager.loadGitignores();
        });

        it('should correctly resolve paths relative to git root', () => {
            // vault/dist/file.js should be ignored by repo root .gitignore
            expect(manager.isIgnored('dist/file.js')).toBe(true);
            
            // vault/test.tmp should be ignored by vault/.gitignore
            expect(manager.isIgnored('test.tmp')).toBe(true);
            
            // vault/src/main.ts should NOT be ignored
            expect(manager.isIgnored('src/main.ts')).toBe(false);
        });
    });

    describe('complex patterns', () => {
        beforeEach(async () => {
            vi.mocked(mockGitService.getRepoGitignores).mockResolvedValue(['.gitignore']);
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            // Content will be set in individual tests
        });

        it('should handle negative patterns (!)', async () => {
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.read).mockResolvedValue('*.log\n!important.log');
            await manager.loadGitignores();

            expect(manager.isIgnored('test.log')).toBe(true);
            expect(manager.isIgnored('important.log')).toBe(false);
        });

        it('should handle directory-only patterns', async () => {
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.read).mockResolvedValue('build/');
            await manager.loadGitignores();

            expect(manager.isIgnored('build/file.js')).toBe(true);
            expect(manager.isIgnored('other/build/file.js')).toBe(true);
        });

        it('should handle deep wildcards (**)', async () => {
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.read).mockResolvedValue('**/temp/*');
            await manager.loadGitignores();

            expect(manager.isIgnored('temp/file.txt')).toBe(true);
            expect(manager.isIgnored('a/b/temp/file.txt')).toBe(true);
            expect(manager.isIgnored('a/temp/foo')).toBe(true);
        });
    });
});
