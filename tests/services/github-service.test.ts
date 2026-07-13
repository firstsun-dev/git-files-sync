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

    describe('getFile symlink detection', () => {
        it('flags a symlink response and returns its target', async () => {
            mockRequest({ status: 200, json: { type: 'symlink', target: '../shared/note.md', sha: 'link-sha' } });
            const result = await service.getFile('link.md', 'main');
            expect(result).toEqual({ content: '', sha: 'link-sha', isSymlink: true, symlinkTarget: '../shared/note.md' });
        });

        it('treats a normal file response as non-symlink', async () => {
            mockRequest({ status: 200, json: { content: btoa('hello'), sha: 'sha', type: 'file' } });
            const result = await service.getFile('note.md', 'main');
            expect(result.isSymlink).toBeUndefined();
            expect(result.content).toBe('hello');
        });
    });

    describe('pushSymlink (Git Data API)', () => {
        it('creates a blob, tree (mode 120000), commit, and moves the ref', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { object: { sha: 'commit1' } } } as unknown as RequestUrlResponse) // get ref
                .mockResolvedValueOnce({ status: 200, json: { tree: { sha: 'tree1' } } } as unknown as RequestUrlResponse)      // get commit
                .mockResolvedValueOnce({ status: 201, json: { sha: 'blob1' } } as unknown as RequestUrlResponse)               // create blob
                .mockResolvedValueOnce({ status: 201, json: { sha: 'tree2' } } as unknown as RequestUrlResponse)               // create tree
                .mockResolvedValueOnce({ status: 201, json: { sha: 'commit2' } } as unknown as RequestUrlResponse)             // create commit
                .mockResolvedValueOnce({ status: 200, json: {} } as unknown as RequestUrlResponse);                            // update ref

            const result = await service.pushSymlink('link.md', '../target.md', 'main', 'add link');

            expect(result).toEqual({ path: 'link.md', sha: 'blob1' });
            const calls = vi.mocked(requestUrl).mock.calls.map(c => c[0] as RequestUrlParam);
            expect(calls).toHaveLength(6);
            // blob carries the target as utf-8
            const blobBody = JSON.parse(calls[2]?.body as string) as { content: string; encoding: string };
            expect(blobBody).toEqual({ content: '../target.md', encoding: 'utf-8' });
            // tree entry uses symlink mode 120000
            const treeBody = JSON.parse(calls[3]?.body as string) as { base_tree: string; tree: Array<{ path: string; mode: string; type: string; sha: string }> };
            expect(treeBody.base_tree).toBe('tree1');
            expect(treeBody.tree[0]).toEqual({ path: 'link.md', mode: '120000', type: 'blob', sha: 'blob1' });
            // ref update points at the new commit
            expect(calls[5]?.method).toBe('PATCH');
            expect(JSON.parse(calls[5]?.body as string)).toEqual({ sha: 'commit2' });
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

        it('listFilesDetailed flags symlinks (mode 120000)', async () => {
            mockRequest({ status: 200, json: { tree: [
                { path: 'real.md', type: 'blob', mode: '100644' },
                { path: 'link.md', type: 'blob', mode: '120000' },
                { path: 'dir', type: 'tree', mode: '040000' },
            ] } });
            expect(await service.listFilesDetailed('main')).toEqual([
                { path: 'real.md', symlink: false },
                { path: 'link.md', symlink: true },
            ]);
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

        it('should throw a message naming the branch when the branch is not found', async () => {
            mockRequest({ status: 404, json: { message: 'Not Found' }, text: 'Not Found' });
            await expect(service.listFiles('missing-branch')).rejects.toThrow(/Branch "missing-branch" was not found/);
        });

        it('listFilesDetailed includes each blob\'s sha', async () => {
            mockRequest({ status: 200, json: { tree: [
                { path: 'file1.md', type: 'blob', sha: 'sha-1' },
                { path: 'file2.md', type: 'blob', sha: 'sha-2' },
            ] } });
            expect(await service.listFilesDetailed('main')).toEqual([
                { path: 'file1.md', symlink: false, sha: 'sha-1' },
                { path: 'file2.md', symlink: false, sha: 'sha-2' },
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
            expect(call.url).toContain('/git/blobs/abc123');
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

        it('should report branchOk: false when the branch is not found', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: {} } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 404, json: { message: 'Not Found' }, text: 'Not Found' } as unknown as RequestUrlResponse);
            const result = await service.testConnection('missing-branch');
            expect(result).toEqual({ repoOk: true, branchOk: false });
        });
    });

    describe('getRepoGitignores', () => {
        sharedGetRepoGitignores(() => service, 'tree');
    });

    describe('getFile error handling', () => {
        sharedGetFileErrorHandling(() => service);
    });
});
