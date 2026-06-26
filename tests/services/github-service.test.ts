import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService } from '../../src/services/github-service';
import { requestUrl, RequestUrlResponse, RequestUrlParam } from 'obsidian';
import { getLastRequestCall, mockRequest, sharedTestConnection, sharedGetFileErrorHandling, sharedGetRepoGitignores } from './service-test-helpers';

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
            mockRequest({ status: 200, json: { content: btoa('hello world'), sha: 'test-sha' } });
            const result = await service.getFile('test.md', 'main');
            expect(result.content).toBe('hello world');
            expect(result.sha).toBe('test-sha');
        });

        it('should handle 404 correctly and return empty content', async () => {
            mockRequest({ status: 404 });
            const result = await service.getFile('missing.md', 'main');
            expect(result.content).toBe('');
            expect(result.sha).toBe('');
        });

        it('should bypass rootPath when path starts with / (absolute repo path)', async () => {
            service.updateConfig(token, owner, repo, 'vault');
            mockRequest({ status: 200, json: { content: btoa('root content'), sha: 'root-sha' } });
            await service.getFile('/.gitignore', 'main');
            const call = getLastRequestCall();
            expect(call.url).toContain('/contents/.gitignore');
            expect(call.url).not.toContain('/contents/vault/.gitignore');
        });

        it('should not double-prefix when path already starts with rootPath', async () => {
            service.updateConfig(token, owner, repo, 'src/content');
            mockRequest({ status: 200, json: { content: btoa('hello'), sha: 'sha' } });
            await service.getFile('src/content/index.md', 'main');
            const call = getLastRequestCall();
            expect(call.url).toContain('/contents/src/content/index.md');
            expect(call.url).not.toContain('/contents/src/content/src/content/index.md');
        });

        it('should return sha correctly', async () => {
            mockRequest({ status: 200, json: { content: btoa('test'), sha: 'explicit-sha' } });
            const result = await service.getFile('test.md', 'main');
            expect(result.sha).toBe('explicit-sha');
        });
    });

    describe('pushFile', () => {
        it('should push new file correctly (no sha provided)', async () => {
            vi.mocked(requestUrl).mockResolvedValueOnce({
                status: 201,
                json: { content: { path: 'new.md', sha: 'new-sha' } }
            } as unknown as RequestUrlResponse);

            const result = await service.pushFile('new.md', 'new content', 'main', 'create');

            expect(result).toEqual({ path: 'new.md', sha: 'new-sha' });
            const call = getLastRequestCall();
            expect(call.method).toBe('PUT');
            expect(call.body).not.toContain('"sha":');
        });

        it('should omit blank sha so creating a new file does not 422', async () => {
            // A 404 lookup yields sha === '' for new files; an empty sha sent to
            // GitHub causes HTTP 422, so it must be dropped from the request body.
            vi.mocked(requestUrl).mockResolvedValueOnce({
                status: 201,
                json: { content: { path: 'new.md', sha: 'new-sha' } }
            } as unknown as RequestUrlResponse);

            const result = await service.pushFile('new.md', 'content', 'main', 'create', '');

            expect(result).toEqual({ path: 'new.md', sha: 'new-sha' });
            const call = getLastRequestCall();
            expect(call.body).not.toContain('"sha":');
        });

        it('should update existing file correctly (sha provided)', async () => {
            mockRequest({ status: 200, json: { content: { path: 'existing.md', sha: 'updated-sha' } } });

            const result = await service.pushFile('existing.md', 'updated content', 'main', 'update', 'old-sha');

            expect(result).toEqual({ path: 'existing.md', sha: 'updated-sha' });
            const call = getLastRequestCall();
            expect(call.method).toBe('PUT');
            expect(call.body).toContain('"sha":"old-sha"');
        });
    });

    describe('listFiles', () => {
        it('should list blob files from tree API', async () => {
            mockRequest({ status: 200, json: { tree: [
                { path: 'file1.md', type: 'blob' },
                { path: 'dir/file2.md', type: 'blob' },
                { path: 'subdir', type: 'tree' },
            ] } });
            expect(await service.listFiles('main')).toEqual(['file1.md', 'dir/file2.md']);
        });

        it('should filter by rootPath when set', async () => {
            service.updateConfig(token, owner, repo, 'vault');
            mockRequest({ status: 200, json: { tree: [
                { path: 'vault/file1.md', type: 'blob' },
                { path: 'other/file2.md', type: 'blob' },
            ] } });
            expect(await service.listFiles('main')).toEqual(['vault/file1.md']);
        });

        it('should not match sibling paths with same prefix as rootPath', async () => {
            service.updateConfig(token, owner, repo, 'src/content');
            mockRequest({ status: 200, json: { tree: [
                { path: 'src/content/index.md', type: 'blob' },
                { path: 'src/content.config.ts', type: 'blob' },
                { path: 'src/contentful.ts', type: 'blob' },
            ] } });
            expect(await service.listFiles('main')).toEqual(['src/content/index.md']);
        });

        it('should return files and log warning when result is truncated', async () => {
            mockRequest({ status: 200, json: { truncated: true, tree: [
                { path: 'file1.md', type: 'blob' },
                { path: 'file2.md', type: 'blob' },
            ] } });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const result = await service.listFiles('main');
            expect(result).toEqual(['file1.md', 'file2.md']);
            warnSpy.mockRestore();
        });
    });

    describe('deleteFile', () => {
        it('should delete file using its sha', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { content: btoa('content'), sha: 'file-sha' } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: {} } as unknown as RequestUrlResponse);

            await service.deleteFile('test.md', 'main', 'delete test.md');

            const calls = vi.mocked(requestUrl).mock.calls;
            expect(calls).toHaveLength(2);
            const deleteCall = calls[1]?.[0] as RequestUrlParam;
            expect(deleteCall.method).toBe('DELETE');
            expect(deleteCall.body).toContain('"sha":"file-sha"');
        });
    });

    describe('testConnection', () => {
        sharedTestConnection(() => service);
    });

    describe('getRepoGitignores', () => {
        sharedGetRepoGitignores(() => service, 'tree');
    });

    describe('getFile error handling', () => {
        sharedGetFileErrorHandling(() => service);
    });
});
