import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabService } from '../../src/services/gitlab-service';
import { requestUrl, RequestUrlResponse, RequestUrlParam } from 'obsidian';

describe('GitLabService', () => {
    let service: GitLabService;
    const baseUrl = 'https://gitlab.com';
    const token = 'test-token';
    const projectId = '123';

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitLabService();
        service.updateConfig(baseUrl, token, projectId, '');
    });

    describe('getFile', () => {
        it('should fetch and decode file content correctly', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    content: btoa('hello world'),
                    last_commit_id: 'test-commit-id'
                }
            } as unknown as RequestUrlResponse;
            vi.mocked(requestUrl).mockResolvedValue(mockResponse);

            const result = await service.getFile('test.md', 'main');

            expect(result.content).toBe('hello world');
            expect(result.sha).toBe('test-commit-id');
            
            const calls = vi.mocked(requestUrl).mock.calls;
            const lastCallParams = calls[0];
            if (!lastCallParams) throw new Error('requestUrl was not called');
            const lastCall = lastCallParams[0] as RequestUrlParam;
            expect(lastCall.method).toBe('GET');
            expect(lastCall.headers).toMatchObject({ 'PRIVATE-TOKEN': token });
        });

        it('should handle 404 correctly in getFile and return empty content', async () => {
            vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as unknown as RequestUrlResponse);
            const result = await service.getFile('missing.md', 'main');
            expect(result.content).toBe('');
            expect(result.sha).toBe('');
        });

        it('should return last_commit_id as sha', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    content: btoa('test content'),
                    last_commit_id: 'test-last-commit-id'
                }
            } as unknown as RequestUrlResponse;
            vi.mocked(requestUrl).mockResolvedValue(mockResponse);
            const result = await service.getFile('test.md', 'main');
            expect(result.sha).toBe('test-last-commit-id');
        });
    });

    describe('pushFile', () => {
        it('should push file content correctly (POST for new file)', async () => {
            vi.mocked(requestUrl).mockResolvedValue({ status: 201, json: { file_path: 'test.md' } } as unknown as RequestUrlResponse);

            const result = await service.pushFile('test.md', 'new content', 'main', 'initial commit');

            expect(result).toBe('test.md');
            const calls = vi.mocked(requestUrl).mock.calls;
            const lastCallParams = calls[calls.length - 1];
            if (!lastCallParams) throw new Error('requestUrl was not called');
            const lastCall = lastCallParams[0] as RequestUrlParam;
            expect(lastCall.method).toBe('POST');
            expect(lastCall.body).toContain(btoa('new content'));
        });

        it('should push file content correctly (PUT for existing file)', async () => {
            vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { file_path: 'test.md' } } as unknown as RequestUrlResponse);

            const result = await service.pushFile('test.md', 'updated content', 'main', 'update', 'old-sha');

            expect(result).toBe('test.md');
            const calls = vi.mocked(requestUrl).mock.calls;
            const lastCallParams = calls[calls.length - 1];
            if (!lastCallParams) throw new Error('requestUrl was not called');
            const lastCall = lastCallParams[0] as RequestUrlParam;
            expect(lastCall.method).toBe('PUT');
            expect(lastCall.body).toContain(btoa('updated content'));
        });
    });

    describe('listFiles', () => {
        it('should list blob files from tree API', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: [
                    { path: 'file1.md', type: 'blob' },
                    { path: 'dir/file2.md', type: 'blob' },
                    { path: 'subdir', type: 'tree' },
                ]
            } as unknown as RequestUrlResponse);

            const result = await service.listFiles('main');
            expect(result).toEqual(['file1.md', 'dir/file2.md']);
        });

        it('should filter by rootPath when set', async () => {
            service.updateConfig(baseUrl, token, projectId, 'vault');
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: [
                    { path: 'vault/file1.md', type: 'blob' },
                    { path: 'other/file2.md', type: 'blob' },
                ]
            } as unknown as RequestUrlResponse);

            const result = await service.listFiles('main');
            expect(result).toEqual(['vault/file1.md']);
        });
    });

    describe('deleteFile', () => {
        it('should delete file with commit message', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: {}
            } as unknown as RequestUrlResponse);

            await service.deleteFile('test.md', 'main', 'delete test.md');

            const calls = vi.mocked(requestUrl).mock.calls;
            const deleteCall = calls[0]?.[0] as RequestUrlParam;
            expect(deleteCall.method).toBe('DELETE');
            expect(deleteCall.body).toContain('"commit_message":"delete test.md"');
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
                json: [
                    { path: '.gitignore', type: 'blob' },
                    { path: 'src/main.ts', type: 'blob' },
                    { path: 'sub/.gitignore', type: 'blob' },
                ]
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
