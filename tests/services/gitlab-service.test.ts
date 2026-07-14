import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabService } from '../../src/services/gitlab-service';
import { RequestUrlResponse, requestUrl } from 'obsidian';
import { getLastRequestCall, mockRequest, sharedTestConnection, sharedGetFileErrorHandling, sharedGetRepoGitignores } from './service-test-helpers';

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
            mockRequest({ status: 200, json: { content: btoa('hello world'), last_commit_id: 'test-commit-id' } });
            const result = await service.getFile('test.md', 'main');
            expect(result.content).toBe('hello world');
            expect(result.sha).toBe('test-commit-id');
            const call = getLastRequestCall();
            expect(call.method).toBe('GET');
            expect(call.headers).toMatchObject({ 'PRIVATE-TOKEN': token });
        });

        it('should handle 404 correctly in getFile and return empty content', async () => {
            mockRequest({ status: 404 });
            const result = await service.getFile('missing.md', 'main');
            expect(result.content).toBe('');
            expect(result.sha).toBe('');
        });

        it('should return last_commit_id as sha', async () => {
            mockRequest({ status: 200, json: { content: btoa('test content'), last_commit_id: 'test-last-commit-id' } });
            const result = await service.getFile('test.md', 'main');
            expect(result.sha).toBe('test-last-commit-id');
        });
    });

    describe('pushFile', () => {
        it('should push file content correctly (POST for new file)', async () => {
            mockRequest({ status: 201, json: { file_path: 'test.md' } });
            const result = await service.pushFile('test.md', 'new content', 'main', 'initial commit');
            expect(result).toEqual({ path: 'test.md' });
            const call = getLastRequestCall();
            expect(call.method).toBe('POST');
            expect(call.body).toContain(btoa('new content'));
        });

        it('should treat a blank sha as a new file (POST, no last_commit_id)', async () => {
            mockRequest({ status: 201, json: { file_path: 'test.md' } });
            await service.pushFile('test.md', 'new content', 'main', 'initial commit', '');
            const call = getLastRequestCall();
            expect(call.method).toBe('POST');
            expect(call.body).not.toContain('last_commit_id');
        });

        it('should push file content correctly (PUT for existing file)', async () => {
            mockRequest({ status: 200, json: { file_path: 'test.md' } });
            const result = await service.pushFile('test.md', 'updated content', 'main', 'update', 'old-sha');
            expect(result).toEqual({ path: 'test.md' });
            const call = getLastRequestCall();
            expect(call.method).toBe('PUT');
            expect(call.body).toContain(btoa('updated content'));
        });
    });

    describe('pushBatch', () => {
        it('returns [] and makes no requests for an empty item list', async () => {
            const result = await service.pushBatch([], 'main', 'push nothing');
            expect(result).toEqual([]);
            expect(requestUrl).not.toHaveBeenCalled();
        });

        it('commits via the Commits API actions array, then reads back shas from a follow-up tree fetch', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 201, json: { id: 'commit-sha' } } as unknown as RequestUrlResponse) // POST commits
                .mockResolvedValueOnce({ status: 200, json: [
                    { path: 'a.md', type: 'blob', id: 'new-sha-a' },
                    { path: 'b.md', type: 'blob', id: 'new-sha-b' },
                ] } as unknown as RequestUrlResponse); // follow-up listFilesDetailed

            const result = await service.pushBatch(
                [
                    { path: 'a.md', content: 'hello', existedRemotely: true },
                    { path: 'b.md', content: 'world', existedRemotely: false },
                ],
                'main',
                'Push 2 file(s) from Obsidian'
            );

            expect(result).toEqual([{ path: 'a.md', sha: 'new-sha-a' }, { path: 'b.md', sha: 'new-sha-b' }]);

            const calls = vi.mocked(requestUrl).mock.calls;
            expect(calls).toHaveLength(2);
            const commitCall = calls[0]?.[0] as { url: string; method: string; body: string };
            expect(commitCall.url).toBe(`${baseUrl}/api/v4/projects/${projectId}/repository/commits`);
            expect(commitCall.method).toBe('POST');
            const body = JSON.parse(commitCall.body) as { branch: string; commit_message: string; actions: Array<{ action: string; file_path: string; content: string; encoding: string }> };
            expect(body.branch).toBe('main');
            expect(body.commit_message).toBe('Push 2 file(s) from Obsidian');
            expect(body.actions).toEqual([
                { action: 'update', file_path: 'a.md', content: btoa('hello'), encoding: 'base64' },
                { action: 'create', file_path: 'b.md', content: btoa('world'), encoding: 'base64' },
            ]);
        });

        it('returns sha: undefined for a pushed path missing from the follow-up tree', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 201, json: { id: 'commit-sha' } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: [] } as unknown as RequestUrlResponse);

            const result = await service.pushBatch([{ path: 'a.md', content: 'hello' }], 'main', 'push');
            expect(result).toEqual([{ path: 'a.md', sha: undefined }]);
        });
    });

    describe('listFiles', () => {
        it('should list blob files from tree API', async () => {
            mockRequest({ status: 200, json: [
                { path: 'file1.md', type: 'blob' },
                { path: 'dir/file2.md', type: 'blob' },
                { path: 'subdir', type: 'tree' },
            ] });
            expect(await service.listFiles('main')).toEqual(['file1.md', 'dir/file2.md']);
        });

        it('should filter by rootPath when set', async () => {
            service.updateConfig(baseUrl, token, projectId, 'vault');
            mockRequest({ status: 200, json: [
                { path: 'vault/file1.md', type: 'blob' },
                { path: 'other/file2.md', type: 'blob' },
            ] });
            expect(await service.listFiles('main')).toEqual(['vault/file1.md']);
        });

        it('listFilesDetailed flags symlinks (mode 120000)', async () => {
            mockRequest({ status: 200, json: [
                { path: 'real.md', type: 'blob', mode: '100644' },
                { path: 'link.md', type: 'blob', mode: '120000' },
            ] });
            expect(await service.listFilesDetailed('main')).toEqual([
                { path: 'real.md', symlink: false },
                { path: 'link.md', symlink: true },
            ]);
        });

        it('should not match sibling paths with same prefix as rootPath', async () => {
            service.updateConfig(baseUrl, token, projectId, 'src/content');
            mockRequest({ status: 200, json: [
                { path: 'src/content/index.md', type: 'blob' },
                { path: 'src/content.config.ts', type: 'blob' },
                { path: 'src/contentful.ts', type: 'blob' },
            ] });
            expect(await service.listFiles('main')).toEqual(['src/content/index.md']);
        });

        it('should fetch all pages when first page is exactly full (100 items)', async () => {
            const page1 = Array.from({ length: 100 }, (_, i) => ({ path: `file${i}.md`, type: 'blob' }));
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: page1 } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: [] } as unknown as RequestUrlResponse);

            const result = await service.listFiles('main');
            expect(result).toHaveLength(100);
            expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(2);
        });

        it('should fetch all pages across multiple full pages (200 items)', async () => {
            const page1 = Array.from({ length: 100 }, (_, i) => ({ path: `a/file${i}.md`, type: 'blob' }));
            const page2 = Array.from({ length: 100 }, (_, i) => ({ path: `b/file${i}.md`, type: 'blob' }));
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: page1 } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: page2 } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: [] } as unknown as RequestUrlResponse);

            const result = await service.listFiles('main');
            expect(result).toHaveLength(200);
            expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(3);
        });

        it('should stop pagination when page has fewer than 100 items', async () => {
            const page1 = Array.from({ length: 100 }, (_, i) => ({ path: `file${i}.md`, type: 'blob' }));
            const page2 = Array.from({ length: 42 }, (_, i) => ({ path: `extra/file${i}.md`, type: 'blob' }));
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: page1 } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: page2 } as unknown as RequestUrlResponse);

            const result = await service.listFiles('main');
            expect(result).toHaveLength(142);
            expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(2);
        });

        it('should throw a message naming the branch when the branch is not found', async () => {
            mockRequest({ status: 404, json: { message: '404 Branch Not Found' }, text: '404 Branch Not Found' });
            await expect(service.listFiles('missing-branch')).rejects.toThrow(/Branch "missing-branch" was not found/);
        });

        it('listFilesDetailed maps GitLab\'s "id" field to sha', async () => {
            mockRequest({ status: 200, json: [
                { path: 'file1.md', type: 'blob', id: 'id-as-sha-1' },
            ] });
            expect(await service.listFilesDetailed('main')).toEqual([
                { path: 'file1.md', symlink: false, sha: 'id-as-sha-1' },
            ]);
        });
    });

    describe('getBlob', () => {
        it('returns the raw text content for a non-binary path', async () => {
            mockRequest({ status: 200, text: 'hello world' });
            const result = await service.getBlob('blob-sha', 'test.md');
            expect(result.content).toBe('hello world');
            expect(result.sha).toBe('blob-sha');
        });

        it('requests the raw blob endpoint by sha', async () => {
            mockRequest({ status: 200, text: 'x' });
            await service.getBlob('abc123', 'test.md');
            const call = getLastRequestCall();
            expect(call.url).toBe(`${baseUrl}/api/v4/projects/${projectId}/repository/blobs/abc123/raw`);
        });

        it('returns arrayBuffer content for a binary path', async () => {
            const buf = new ArrayBuffer(4);
            mockRequest({ status: 200, arrayBuffer: buf });
            const result = await service.getBlob('blob-sha', 'image.png');
            expect(result.content).toBe(buf);
        });
    });

    describe('deleteFile', () => {
        it('should delete file with commit message', async () => {
            mockRequest({ status: 200, json: {} });
            await service.deleteFile('test.md', 'main', 'delete test.md');
            const call = getLastRequestCall();
            expect(call.method).toBe('DELETE');
            expect(call.body).toContain('"commit_message":"delete test.md"');
        });
    });

    describe('testConnection', () => {
        sharedTestConnection(() => service);

        it('should report branchOk: false when the branch is not found', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: {} } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 404, json: { message: 'Branch Not Found' }, text: 'Branch Not Found' } as unknown as RequestUrlResponse);
            const result = await service.testConnection('missing-branch');
            expect(result).toEqual({ repoOk: true, branchOk: false });
        });
    });

    describe('getRepoGitignores', () => {
        sharedGetRepoGitignores(() => service, 'json');
    });

    describe('getFile error handling', () => {
        sharedGetFileErrorHandling(() => service);
    });
});
