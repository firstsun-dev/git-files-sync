import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GiteaService } from '../../src/services/gitea-service';
import { requestUrl, RequestUrlResponse, RequestUrlParam } from 'obsidian';
import { getLastRequestCall, mockRequest, sharedTestConnection, sharedGetFileErrorHandling } from './service-test-helpers';

describe('GiteaService', () => {
    let service: GiteaService;
    const baseUrl = 'https://gitea.example.com';
    const token = 'test-token';
    const owner = 'test-owner';
    const repo = 'test-repo';

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GiteaService();
        service.updateConfig(baseUrl, token, owner, repo);
    });

    describe('updateConfig', () => {
        it('should strip trailing slash from baseUrl', async () => {
            service.updateConfig('https://gitea.example.com/', token, owner, repo);
            mockRequest({ status: 200, json: { content: btoa('hello'), sha: 'sha' } });
            await service.getFile('test.md', 'main');
            const call = getLastRequestCall();
            expect(call.url).not.toContain('example.com//api');
            expect(call.url).toContain('example.com/api/v1');
        });
    });

    describe('getFile', () => {
        it('should fetch and decode file content correctly', async () => {
            mockRequest({ status: 200, json: { content: btoa('hello world'), sha: 'test-sha' } });
            const result = await service.getFile('test.md', 'main');
            expect(result.content).toBe('hello world');
            expect(result.sha).toBe('test-sha');
        });

        it('should call the correct Gitea contents API URL', async () => {
            mockRequest({ status: 200, json: { content: btoa('data'), sha: 'sha1' } });
            await service.getFile('notes/hello.md', 'main');
            const call = getLastRequestCall();
            expect(call.url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/contents/notes/hello.md?ref=main`);
        });

        it('should use Authorization token header', async () => {
            mockRequest({ status: 200, json: { content: btoa('data'), sha: 'sha1' } });
            await service.getFile('test.md', 'main');
            const call = getLastRequestCall();
            expect(call.headers).toMatchObject({ 'Authorization': `token ${token}` });
        });

        it('should handle 404 correctly and return empty content', async () => {
            mockRequest({ status: 404, json: { message: 'Not Found' }, text: 'Not Found' });
            const result = await service.getFile('missing.md', 'main');
            expect(result.content).toBe('');
            expect(result.sha).toBe('');
        });

        it('should bypass rootPath when path starts with / (absolute repo path)', async () => {
            service.updateConfig(baseUrl, token, owner, repo, 'vault');
            mockRequest({ status: 200, json: { content: btoa('root content'), sha: 'root-sha' } });
            await service.getFile('/.gitignore', 'main');
            const call = getLastRequestCall();
            expect(call.url).toContain('/contents/.gitignore');
            expect(call.url).not.toContain('/contents/vault/.gitignore');
        });

        it('should not double-prefix when path already starts with rootPath', async () => {
            service.updateConfig(baseUrl, token, owner, repo, 'src/content');
            mockRequest({ status: 200, json: { content: btoa('hello'), sha: 'sha' } });
            await service.getFile('src/content/index.md', 'main');
            const call = getLastRequestCall();
            expect(call.url).toContain('/contents/src/content/index.md');
            expect(call.url).not.toContain('/contents/src/content/src/content/index.md');
        });

        it('should prepend rootPath when set', async () => {
            service.updateConfig(baseUrl, token, owner, repo, 'vault');
            mockRequest({ status: 200, json: { content: btoa('data'), sha: 'sha' } });
            await service.getFile('notes.md', 'main');
            const call = getLastRequestCall();
            expect(call.url).toContain('/contents/vault/notes.md');
        });
    });

    describe('pushFile', () => {
        it('should create new file with POST when no sha provided', async () => {
            mockRequest({ status: 201, json: { content: { path: 'new.md', sha: 'new-sha' } } });
            const result = await service.pushFile('new.md', 'new content', 'main', 'create');
            expect(result).toEqual({ path: 'new.md', sha: 'new-sha' });
            const call = getLastRequestCall();
            expect(call.method).toBe('POST');
        });

        it('should update existing file with PUT when sha provided', async () => {
            mockRequest({ status: 200, json: { content: { path: 'existing.md', sha: 'updated-sha' } } });
            const result = await service.pushFile('existing.md', 'updated content', 'main', 'update', 'old-sha');
            expect(result).toEqual({ path: 'existing.md', sha: 'updated-sha' });
            const call = getLastRequestCall();
            expect(call.method).toBe('PUT');
            expect(call.body).toContain('"sha":"old-sha"');
        });

        it('should send correct content URL for push', async () => {
            mockRequest({ status: 201, json: { content: { path: 'notes/test.md', sha: 'sha' } } });
            await service.pushFile('notes/test.md', 'content', 'main', 'commit');
            const call = getLastRequestCall();
            expect(call.url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/contents/notes/test.md`);
        });

        it('should base64 encode the file content', async () => {
            mockRequest({ status: 201, json: { content: { path: 'test.md', sha: 'sha' } } });
            await service.pushFile('test.md', 'hello world', 'main', 'add file');
            const call = getLastRequestCall();
            const body = JSON.parse(call.body as string) as { content: string };
            expect(atob(body.content)).toContain('hello world');
        });
    });

    describe('pushBatch', () => {
        it('returns [] and makes no requests for an empty item list', async () => {
            const result = await service.pushBatch([], 'main', 'push nothing');
            expect(result).toEqual([]);
            expect(requestUrl).not.toHaveBeenCalled();
        });

        it('commits N files in one request to the contents batch endpoint', async () => {
            mockRequest({ status: 201, json: { files: [{ path: 'a.md', sha: 'blob-a' }] } });

            const result = await service.pushBatch([{ path: 'a.md', content: 'hello' }], 'main', 'Push 1 file(s) from Obsidian');

            expect(result).toEqual([{ path: 'a.md', sha: 'blob-a' }]);

            const call = getLastRequestCall();
            expect(call.method).toBe('POST');
            expect(call.url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/contents`);
            const body = JSON.parse(call.body as string) as { branch: string; message: string; files: Array<{ operation: string; path: string; content: string }> };
            expect(body.branch).toBe('main');
            expect(body.files).toEqual([{ operation: 'create', path: 'a.md', content: btoa('hello') }]);
        });

        it('uses operation "update" for items that already existed remotely', async () => {
            mockRequest({ status: 201, json: { files: [{ path: 'a.md', sha: 'blob-a2' }] } });

            await service.pushBatch([{ path: 'a.md', content: 'hello', existedRemotely: true }], 'main', 'Update 1 file(s) from Obsidian');

            const call = getLastRequestCall();
            const body = JSON.parse(call.body as string) as { files: Array<{ operation: string }> };
            expect(body.files[0]?.operation).toBe('update');
        });
    });

    describe('listFiles', () => {
        const commitSha = 'abc123commit';

        function mockListFiles(treeItems: { path: string; type: string }[], truncated = false): void {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { commit: { id: commitSha } } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: { tree: treeItems, truncated } } as unknown as RequestUrlResponse);
        }

        it('should first resolve branch to commit SHA then fetch tree', async () => {
            mockListFiles([]);
            await service.listFiles('main');
            const calls = vi.mocked(requestUrl).mock.calls;
            expect(calls).toHaveLength(2);
            expect((calls[0]?.[0] as RequestUrlParam).url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/branches/main`);
            expect((calls[1]?.[0] as RequestUrlParam).url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`);
        });

        it('should return only blob files from tree', async () => {
            mockListFiles([
                { path: 'file1.md', type: 'blob' },
                { path: 'dir/file2.md', type: 'blob' },
                { path: 'subdir', type: 'tree' },
            ]);
            expect(await service.listFiles('main')).toEqual(['file1.md', 'dir/file2.md']);
        });

        it('should filter by rootPath when set', async () => {
            service.updateConfig(baseUrl, token, owner, repo, 'vault');
            mockListFiles([
                { path: 'vault/file1.md', type: 'blob' },
                { path: 'other/file2.md', type: 'blob' },
            ]);
            expect(await service.listFiles('main')).toEqual(['vault/file1.md']);
        });

        it('should not match sibling paths with same prefix as rootPath', async () => {
            service.updateConfig(baseUrl, token, owner, repo, 'src/content');
            mockListFiles([
                { path: 'src/content/index.md', type: 'blob' },
                { path: 'src/content.config.ts', type: 'blob' },
                { path: 'src/contentful.ts', type: 'blob' },
            ]);
            expect(await service.listFiles('main')).toEqual(['src/content/index.md']);
        });

        it('should return all files when useFilter is false regardless of rootPath', async () => {
            service.updateConfig(baseUrl, token, owner, repo, 'vault');
            mockListFiles([
                { path: 'vault/file1.md', type: 'blob' },
                { path: 'other/file2.md', type: 'blob' },
            ]);
            expect(await service.listFiles('main', false)).toEqual(['vault/file1.md', 'other/file2.md']);
        });

        it('fails closed when the tree result is truncated', async () => {
            mockListFiles([{ path: 'file1.md', type: 'blob' }], true);
            await expect(service.listFiles('main')).rejects.toThrow(/truncated; sync stopped/);
        });

        it('should throw a message naming the branch when the branch is not found', async () => {
            mockRequest({ status: 404, json: { message: 'branch does not exist' }, text: 'branch does not exist' });
            await expect(service.listFiles('missing-branch')).rejects.toThrow(/Branch "missing-branch" was not found/);
        });

        it('listFilesDetailed includes each blob\'s sha', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { commit: { id: commitSha } } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: { tree: [
                    { path: 'file1.md', type: 'blob', sha: 'sha-1' },
                ] } } as unknown as RequestUrlResponse);
            expect(await service.listFilesDetailed('main')).toEqual([
                { path: 'file1.md', symlink: false, sha: 'sha-1' },
            ]);
        });
    });

    describe('getBlob', () => {
        it('decodes base64 blob content by sha', async () => {
            mockRequest({ status: 200, json: { content: btoa('hello world'), encoding: 'base64', sha: 'blob-sha' } });
            const result = await service.getBlob('blob-sha', 'test.md');
            expect(result.content).toBe('hello world');
            expect(result.sha).toBe('blob-sha');
        });

        it('requests the blob endpoint by sha, not path', async () => {
            mockRequest({ status: 200, json: { content: btoa('x'), sha: 'abc123' } });
            await service.getBlob('abc123', 'test.md');
            const call = getLastRequestCall();
            expect(call.url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/git/blobs/abc123`);
        });
    });

    describe('deleteFile', () => {
        it('should first get file sha then send DELETE request', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { content: btoa('content'), sha: 'file-sha' } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: {} } as unknown as RequestUrlResponse);

            await service.deleteFile('test.md', 'main', 'delete test.md');

            const calls = vi.mocked(requestUrl).mock.calls;
            expect(calls).toHaveLength(2);
            const deleteCall = calls[1]?.[0] as RequestUrlParam;
            expect(deleteCall.method).toBe('DELETE');
            expect(deleteCall.body).toContain('"sha":"file-sha"');
            expect(deleteCall.body).toContain('"message":"delete test.md"');
            expect(deleteCall.body).toContain('"branch":"main"');
        });

        it('should use correct delete URL', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { content: btoa('content'), sha: 'sha' } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: {} } as unknown as RequestUrlResponse);

            await service.deleteFile('notes/test.md', 'main', 'remove');

            const calls = vi.mocked(requestUrl).mock.calls;
            const deleteCall = calls[1]?.[0] as RequestUrlParam;
            expect(deleteCall.url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/contents/notes/test.md`);
        });

        it('should throw instead of sending an empty sha when the pre-delete lookup 404s', async () => {
            mockRequest({ status: 404 });

            await expect(service.deleteFile('missing.md', 'main', 'delete missing.md')).rejects.toThrow('missing.md');

            const calls = vi.mocked(requestUrl).mock.calls;
            expect(calls).toHaveLength(1); // no DELETE request was sent
        });

        it('should URL-encode path segments with spaces or non-ASCII characters', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { content: btoa('content'), sha: 'file-sha' } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: {} } as unknown as RequestUrlResponse);

            await service.deleteFile('folder/我的 筆記.md', 'main', 'delete note');

            const calls = vi.mocked(requestUrl).mock.calls;
            const getCall = calls[0]?.[0] as RequestUrlParam;
            expect(getCall.url).toContain('/contents/folder/');
            expect(getCall.url).not.toContain(' ');
            expect(getCall.url).not.toContain('我的');
        });
    });

    describe('deleteBatch', () => {
        it('returns and makes no requests for an empty path list', async () => {
            await service.deleteBatch([], 'main', 'delete nothing');
            expect(requestUrl).not.toHaveBeenCalled();
        });

        it('deletes N files in one request to the contents batch endpoint', async () => {
            mockRequest({ status: 201, json: { files: [null] } });

            await service.deleteBatch(['a.md'], 'main', 'Delete 1 file(s) from Obsidian');

            const call = getLastRequestCall();
            expect(call.method).toBe('POST');
            expect(call.url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/contents`);
            const body = JSON.parse(call.body as string) as { files: Array<{ operation: string; path: string }> };
            expect(body.files).toEqual([{ operation: 'delete', path: 'a.md' }]);
        });
    });

    describe('commitBatch', () => {
        it('returns [] and makes no requests when both additions and moves are empty', async () => {
            const result = await service.commitBatch([], [], 'main', 'nothing');
            expect(result).toEqual([]);
            expect(requestUrl).not.toHaveBeenCalled();
        });

        it('creates additions and moves (with from_path) in one request to the contents batch endpoint', async () => {
            mockRequest({
                status: 201,
                json: { files: [{ path: 'a.md', sha: 'blob-a' }, { path: 'new.md', sha: 'blob-move' }] },
            });

            const result = await service.commitBatch(
                [{ path: 'a.md', content: 'hello' }],
                [{ oldPath: 'old.md', newPath: 'new.md', content: 'moved content' }],
                'main',
                'Push 1 file(s) and move 1 file(s) from Obsidian'
            );

            expect(result).toEqual([
                { path: 'a.md', sha: 'blob-a' },
                { path: 'new.md', sha: 'blob-move' },
            ]);

            const call = getLastRequestCall();
            expect(call.method).toBe('POST');
            expect(call.url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}/contents`);
            const body = JSON.parse(call.body as string) as { files: Array<{ operation: string; path: string; from_path?: string }> };
            expect(body.files).toEqual([
                { operation: 'create', path: 'a.md', content: btoa('hello') },
                { operation: 'update', path: 'new.md', from_path: 'old.md', content: btoa('moved content') },
            ]);
        });
    });

    describe('testConnection', () => {
        sharedTestConnection(() => service);

        it('should call the correct repo API URL', async () => {
            mockRequest({ status: 200, json: {} });
            await service.testConnection('main');
            const calls = vi.mocked(requestUrl).mock.calls;
            const firstCall = calls[0]?.[0] as RequestUrlParam;
            expect(firstCall.url).toBe(`${baseUrl}/api/v1/repos/${owner}/${repo}`);
        });

        it('should report branchOk: false when the branch is not found', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: {} } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 404, json: { message: 'not found' }, text: 'not found' } as unknown as RequestUrlResponse);
            const result = await service.testConnection('missing-branch');
            expect(result).toEqual({ repoOk: true, branchOk: false });
        });
    });

    describe('getRepoGitignores', () => {
        it('should return only .gitignore paths from file list', async () => {
            const items = [
                { path: '.gitignore', type: 'blob' },
                { path: 'src/main.ts', type: 'blob' },
                { path: 'sub/.gitignore', type: 'blob' },
            ];
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { commit: { id: 'sha123' } } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: { tree: items, truncated: false } } as unknown as RequestUrlResponse);
            expect(await service.getRepoGitignores('main')).toEqual(['.gitignore', 'sub/.gitignore']);
        });
    });

    describe('getFile error handling', () => {
        sharedGetFileErrorHandling(() => service);
    });
});
