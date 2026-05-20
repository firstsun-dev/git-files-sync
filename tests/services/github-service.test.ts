import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService } from '../../src/services/github-service';
import { requestUrl, RequestUrlResponse, RequestUrlParam } from 'obsidian';

describe('GitHubService', () => {
    let service: GitHubService;
    const token = 'test-token';
    const owner = 'test-owner';
    const repo = 'test-repo';

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitHubService();
        service.updateConfig(token, owner, repo);
    });

    describe('getFile', () => {
        it('should fetch and decode file content correctly', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    content: btoa('hello world'),
                    sha: 'test-sha'
                }
            };
            vi.mocked(requestUrl).mockResolvedValue(mockResponse as unknown as RequestUrlResponse);

            const result = await service.getFile('test.md', 'main');

            expect(result.content).toBe('hello world');
            expect(result.sha).toBe('test-sha');
        });

        it('should handle 404 correctly and return empty content', async () => {
            vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as unknown as RequestUrlResponse);
            const result = await service.getFile('missing.md', 'main');
            expect(result.content).toBe('');
            expect(result.sha).toBe('');
        });

        it('should bypass rootPath when path starts with / (absolute repo path)', async () => {
            service.updateConfig(token, owner, repo, 'vault');
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: { content: btoa('root content'), sha: 'root-sha' }
            } as unknown as RequestUrlResponse);

            await service.getFile('/.gitignore', 'main');

            const call = vi.mocked(requestUrl).mock.calls[0]?.[0] as RequestUrlParam;
            // URL should reference the repo root .gitignore, NOT vault/.gitignore
            expect(call.url).toContain('/contents/.gitignore');
            expect(call.url).not.toContain('/contents/vault/.gitignore');
        });

        it('should not double-prefix when path already starts with rootPath', async () => {
            service.updateConfig(token, owner, repo, 'src/content');
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: { content: btoa('hello'), sha: 'sha' }
            } as unknown as RequestUrlResponse);

            // Path already includes rootPath (e.g. came from listFiles when vault = repo root)
            await service.getFile('src/content/index.md', 'main');

            const call = vi.mocked(requestUrl).mock.calls[0]?.[0] as RequestUrlParam;
            expect(call.url).toContain('/contents/src/content/index.md');
            expect(call.url).not.toContain('/contents/src/content/src/content/index.md');
        });

        it('should return sha correctly', async () => {
            const mockResponse = {
                status: 200,
                json: { content: btoa('test'), sha: 'explicit-sha' }
            };
            vi.mocked(requestUrl).mockResolvedValue(mockResponse as unknown as RequestUrlResponse);
            const result = await service.getFile('test.md', 'main');
            expect(result.sha).toBe('explicit-sha');
        });
    });

    describe('pushFile', () => {
        it('should push new file correctly (no sha provided)', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ 
                    status: 201, 
                    json: { content: { path: 'new.md', sha: 'new-sha' } } 
                } as unknown as RequestUrlResponse);

            const result = await service.pushFile('new.md', 'new content', 'main', 'create');

            expect(result).toEqual({ path: 'new.md', sha: 'new-sha' });
            const calls = vi.mocked(requestUrl).mock.calls;
            const lastCallParams = calls[calls.length - 1];
            if (!lastCallParams) throw new Error('lastCall is undefined');
            const lastCall = lastCallParams[0] as RequestUrlParam;
            expect(lastCall.method).toBe('PUT');
            expect(lastCall.body).not.toContain('"sha":');
        });

        it('should update existing file correctly (sha provided)', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: { content: { path: 'existing.md', sha: 'updated-sha' } }
            } as unknown as RequestUrlResponse);

            const result = await service.pushFile('existing.md', 'updated content', 'main', 'update', 'old-sha');

            expect(result).toEqual({ path: 'existing.md', sha: 'updated-sha' });
            const calls = vi.mocked(requestUrl).mock.calls;
            const lastCallParams = calls[calls.length - 1];
            if (!lastCallParams) throw new Error('lastCall is undefined');
            const lastCall = lastCallParams[0] as RequestUrlParam;
            expect(lastCall.method).toBe('PUT');
            expect(lastCall.body).toContain('"sha":"old-sha"');
        });
    });

    describe('listFiles', () => {
        it('should list blob files from tree API', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: {
                    tree: [
                        { path: 'file1.md', type: 'blob' },
                        { path: 'dir/file2.md', type: 'blob' },
                        { path: 'subdir', type: 'tree' },
                    ]
                }
            } as unknown as RequestUrlResponse);

            const result = await service.listFiles('main');
            expect(result).toEqual(['file1.md', 'dir/file2.md']);
        });

        it('should filter by rootPath when set', async () => {
            service.updateConfig(token, owner, repo, 'vault');
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: {
                    tree: [
                        { path: 'vault/file1.md', type: 'blob' },
                        { path: 'other/file2.md', type: 'blob' },
                    ]
                }
            } as unknown as RequestUrlResponse);

            const result = await service.listFiles('main');
            expect(result).toEqual(['vault/file1.md']);
        });

        it('should not match sibling paths with same prefix as rootPath', async () => {
            service.updateConfig(token, owner, repo, 'src/content');
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: {
                    tree: [
                        { path: 'src/content/index.md', type: 'blob' },
                        { path: 'src/content.config.ts', type: 'blob' },
                        { path: 'src/contentful.ts', type: 'blob' },
                    ]
                }
            } as unknown as RequestUrlResponse);

            const result = await service.listFiles('main');
            expect(result).toEqual(['src/content/index.md']);
        });
    });

    describe('deleteFile', () => {
        it('should delete file using its sha', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({
                    status: 200,
                    json: { content: btoa('content'), sha: 'file-sha' }
                } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({
                    status: 200,
                    json: {}
                } as unknown as RequestUrlResponse);

            await service.deleteFile('test.md', 'main', 'delete test.md');

            const calls = vi.mocked(requestUrl).mock.calls;
            expect(calls).toHaveLength(2);
            const deleteCall = calls[1]?.[0] as RequestUrlParam;
            expect(deleteCall.method).toBe('DELETE');
            expect(deleteCall.body).toContain('"sha":"file-sha"');
        });
    });

    describe('testConnection', () => {
        it('should return true on successful connection', async () => {
            vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: {} } as unknown as RequestUrlResponse);
            const result = await service.testConnection();
            expect(result).toBe(true);
        });

        it('should return false on failed connection', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 401,
                json: { message: 'Unauthorized' },
                text: 'Unauthorized'
            } as unknown as RequestUrlResponse);
            const result = await service.testConnection();
            expect(result).toBe(false);
        });
    });

    describe('getRepoGitignores', () => {
        it('should return only .gitignore paths from file list', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: {
                    tree: [
                        { path: '.gitignore', type: 'blob' },
                        { path: 'src/main.ts', type: 'blob' },
                        { path: 'sub/.gitignore', type: 'blob' },
                    ]
                }
            } as unknown as RequestUrlResponse);

            const result = await service.getRepoGitignores('main');
            expect(result).toEqual(['.gitignore', 'sub/.gitignore']);
        });
    });

    describe('getFile error handling', () => {
        it('should rethrow non-404 errors', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 500,
                json: { message: 'Internal Server Error' },
                text: 'Internal Server Error'
            } as unknown as RequestUrlResponse);

            await expect(service.getFile('test.md', 'main')).rejects.toThrow('500');
        });
    });
});
