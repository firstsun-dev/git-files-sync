import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService } from '../../src/services/github-service';
import { requestUrl, RequestUrlResponse, RequestUrlParam } from 'obsidian';
import { getLastRequestCall, mockRequest, sharedTestConnection, sharedGetFileErrorHandling, sharedGetRepoGitignores } from './service-test-helpers';

/**
 * The GraphQL branch-head read that resolves `expectedHeadOid` for
 * createCommitOnBranch (the REST git/ref read is cacheable, so the batch
 * commit path deliberately doesn't use it).
 */
const headOidResponse = (oid: string) =>
    ({ status: 200, json: { data: { repository: { ref: { target: { oid } } } } } } as unknown as RequestUrlResponse);

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

    describe('pushBatch', () => {
        it('returns [] and makes no requests for an empty item list', async () => {
            const result = await service.pushBatch([], 'main', 'push nothing');
            expect(result).toEqual([]);
            expect(requestUrl).not.toHaveBeenCalled();
        });

        it('commits N files in one GraphQL mutation via head query -> createCommitOnBranch -> tree', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce(headOidResponse('commit1')) // branch head query
                .mockResolvedValueOnce({ status: 200, json: { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } } } as unknown as RequestUrlResponse) // mutation
                .mockResolvedValueOnce({ status: 200, json: { tree: [{ path: 'a.md', type: 'blob', sha: 'blob-a' }, { path: 'b.md', type: 'blob', sha: 'blob-b' }], truncated: false } } as unknown as RequestUrlResponse); // fresh tree

            const result = await service.pushBatch(
                [{ path: 'a.md', content: 'hello' }, { path: 'b.md', content: 'world' }],
                'main',
                'Push 2 file(s) from Obsidian'
            );

            expect(result).toEqual([{ path: 'a.md', sha: 'blob-a' }, { path: 'b.md', sha: 'blob-b' }]);

            const calls = vi.mocked(requestUrl).mock.calls.map(c => c[0] as RequestUrlParam);
            expect(calls).toHaveLength(3);
            expect(calls[1]?.url).toBe('https://api.github.com/graphql');
            expect(calls[1]?.method).toBe('POST');

            const mutationBody = JSON.parse(calls[1]?.body as string) as {
                variables: { input: { branch: { repositoryNameWithOwner: string; branchName: string }; message: { headline: string }; expectedHeadOid: string; fileChanges: { additions: Array<{ path: string; contents: string }> } } };
            };
            const input = mutationBody.variables.input;
            expect(input.branch).toEqual({ repositoryNameWithOwner: `${owner}/${repo}`, branchName: 'main' });
            expect(input.message).toEqual({ headline: 'Push 2 file(s) from Obsidian' });
            expect(input.expectedHeadOid).toBe('commit1');
            // contents are base64-encoded (not pushSymlink's raw utf-8 path), so binary content works too.
            expect(atob(input.fileChanges.additions[0]!.contents)).toBe('hello');
            expect(input.fileChanges.additions).toEqual([
                { path: 'a.md', contents: btoa('hello') },
                { path: 'b.md', contents: btoa('world') },
            ]);
        });

        it('throws when the GraphQL response reports errors on an HTTP 200', async () => {
            // GraphQL reports mutation failures (e.g. a stale expectedHeadOid) as a
            // 200 response with an `errors` array, not an HTTP error status.
            vi.mocked(requestUrl)
                .mockResolvedValueOnce(headOidResponse('commit1')) // branch head query
                .mockResolvedValueOnce({ status: 200, json: { errors: [{ message: 'Resource not accessible by personal access token' }] } } as unknown as RequestUrlResponse); // mutation failure

            await expect(service.pushBatch(
                [{ path: 'a.md', content: 'hello' }],
                'main',
                'Push 1 file(s) from Obsidian'
            )).rejects.toThrow('Resource not accessible by personal access token');
        });

        it('retries with a freshly re-read HEAD when the mutation reports a stale-expectedHeadOid-shaped error', async () => {
            // Regression test: a push immediately followed by another commit to the
            // same branch (e.g. push then delete) can read a HEAD that hasn't caught
            // up yet, so a file the caller expects to exist/not-exist isn't there —
            // GitHub reports this as "path does not exist in tree <oid>", not as an
            // obviously-named staleness error. A retry with a fresh HEAD self-heals.
            vi.useFakeTimers();
            try {
                vi.mocked(requestUrl)
                    .mockResolvedValueOnce(headOidResponse('stale-commit')) // branch head query (stale)
                    .mockResolvedValueOnce({ status: 200, json: { errors: [{ message: 'A path was requested for deletion, but that path does not exist in tree `stale-commit`' }] } } as unknown as RequestUrlResponse) // mutation fails
                    .mockResolvedValueOnce(headOidResponse('fresh-commit')) // branch head query (fresh, retry)
                    .mockResolvedValueOnce({ status: 200, json: { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } } } as unknown as RequestUrlResponse) // mutation succeeds
                    .mockResolvedValueOnce({ status: 200, json: { tree: [{ path: 'a.md', type: 'blob', sha: 'blob-a' }], truncated: false } } as unknown as RequestUrlResponse); // fresh tree

                const resultPromise = service.pushBatch([{ path: 'a.md', content: 'hello' }], 'main', 'Push 1 file(s) from Obsidian');
                await vi.runAllTimersAsync();
                const result = await resultPromise;

                expect(result).toEqual([{ path: 'a.md', sha: 'blob-a' }]);
                const calls = vi.mocked(requestUrl).mock.calls.map(c => c[0] as RequestUrlParam);
                expect(calls).toHaveLength(5);
                const firstMutation = JSON.parse(calls[1]?.body as string) as { variables: { input: { expectedHeadOid: string } } };
                const retryMutation = JSON.parse(calls[3]?.body as string) as { variables: { input: { expectedHeadOid: string } } };
                expect(firstMutation.variables.input.expectedHeadOid).toBe('stale-commit');
                expect(retryMutation.variables.input.expectedHeadOid).toBe('fresh-commit');
            } finally {
                vi.useRealTimers();
            }
        });

        it('retries when the branch moved under the push ("Expected branch to point to ...")', async () => {
            // Regression test for the reported bug: pushing a batch whose commit
            // races another write to the branch fails with GitHub's own wording,
            // "Expected branch to point to \"<oid>\" but it did not. Pull and try
            // again." — which no earlier staleness pattern matched, so the whole
            // chunk was reported as failed without a single retry.
            vi.useFakeTimers();
            try {
                vi.mocked(requestUrl)
                    .mockResolvedValueOnce(headOidResponse('27f5f12')) // branch head query (already superseded)
                    .mockResolvedValueOnce({ status: 200, json: { errors: [{ message: 'Expected branch to point to "27f5f12" but it did not.  Pull and try again.' }] } } as unknown as RequestUrlResponse) // mutation fails
                    .mockResolvedValueOnce(headOidResponse('fresh-commit')) // branch head query (fresh, retry)
                    .mockResolvedValueOnce({ status: 200, json: { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } } } as unknown as RequestUrlResponse) // mutation succeeds
                    .mockResolvedValueOnce({ status: 200, json: { tree: [{ path: 'a.md', type: 'blob', sha: 'blob-a' }], truncated: false } } as unknown as RequestUrlResponse); // fresh tree

                const resultPromise = service.pushBatch([{ path: 'a.md', content: 'hello' }], 'main', 'Push 1 file(s) from Obsidian');
                await vi.runAllTimersAsync();

                expect(await resultPromise).toEqual([{ path: 'a.md', sha: 'blob-a' }]);
                const calls = vi.mocked(requestUrl).mock.calls.map(c => c[0] as RequestUrlParam);
                const retryMutation = JSON.parse(calls[3]?.body as string) as { variables: { input: { expectedHeadOid: string } } };
                expect(retryMutation.variables.input.expectedHeadOid).toBe('fresh-commit');
            } finally {
                vi.useRealTimers();
            }
        });

        it('reads expectedHeadOid over GraphQL, not the cacheable REST ref endpoint', async () => {
            // GitHub serves REST reads as `private, max-age=60`, so a cached
            // git/ref response would keep feeding the retry the same stale oid.
            vi.mocked(requestUrl)
                .mockResolvedValueOnce(headOidResponse('commit1')) // branch head query
                .mockResolvedValueOnce({ status: 200, json: { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } } } as unknown as RequestUrlResponse) // mutation
                .mockResolvedValueOnce({ status: 200, json: { tree: [{ path: 'a.md', type: 'blob', sha: 'blob-a' }], truncated: false } } as unknown as RequestUrlResponse); // fresh tree

            await service.pushBatch([{ path: 'a.md', content: 'hello' }], 'main', 'Push 1 file(s) from Obsidian');

            const headRead = vi.mocked(requestUrl).mock.calls[0]?.[0] as RequestUrlParam;
            expect(headRead.url).toBe('https://api.github.com/graphql');
            expect(headRead.method).toBe('POST');
            const headBody = JSON.parse(headRead.body as string) as { variables: { qualifiedName: string } };
            expect(headBody.variables.qualifiedName).toBe('refs/heads/main');
        });

        it('gives up after 3 attempts with a message naming the branch, keeping GitHub\'s own text', async () => {
            vi.useFakeTimers();
            try {
                const staleError = { status: 200, json: { errors: [{ message: 'Expected branch to point to "27f5f12" but it did not.  Pull and try again.' }] } } as unknown as RequestUrlResponse;
                vi.mocked(requestUrl)
                    .mockResolvedValueOnce(headOidResponse('27f5f12')).mockResolvedValueOnce(staleError)
                    .mockResolvedValueOnce(headOidResponse('27f5f12')).mockResolvedValueOnce(staleError)
                    .mockResolvedValueOnce(headOidResponse('27f5f12')).mockResolvedValueOnce(staleError);

                const settled = service.pushBatch([{ path: 'a.md', content: 'hello' }], 'main', 'Push 1 file(s) from Obsidian')
                    .catch((e: unknown) => e);
                await vi.runAllTimersAsync();
                const error = await settled;

                expect(error).toBeInstanceOf(Error);
                // GitHub's own wording is kept — it names the oid that was rejected.
                expect((error as Error).message).toContain('Expected branch to point to "27f5f12"');
                expect((error as Error).message).toContain('branch "main" kept moving during the push (3 attempts)');
                expect(requestUrl).toHaveBeenCalledTimes(6);
            } finally {
                vi.useRealTimers();
            }
        });

        it('does not retry an unrelated GraphQL error', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce(headOidResponse('commit1')) // branch head query
                .mockResolvedValueOnce({ status: 200, json: { errors: [{ message: 'Resource not accessible by integration' }] } } as unknown as RequestUrlResponse); // unrelated failure

            await expect(service.pushBatch(
                [{ path: 'a.md', content: 'hello' }],
                'main',
                'Push 1 file(s) from Obsidian'
            )).rejects.toThrow('Resource not accessible by integration');

            expect(requestUrl).toHaveBeenCalledTimes(2);
        });

        it('retries the follow-up tree fetch when it is still missing a just-committed file', async () => {
            // The tree-by-branch-name read used to recover blob shas after the
            // commit succeeds is exposed to the same eventual-consistency lag as
            // the expectedHeadOid read — it can briefly omit a file that was just
            // written, rather than erroring outright.
            vi.useFakeTimers();
            try {
                vi.mocked(requestUrl)
                    .mockResolvedValueOnce(headOidResponse('commit1')) // branch head query
                    .mockResolvedValueOnce({ status: 200, json: { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } } } as unknown as RequestUrlResponse) // mutation succeeds
                    .mockResolvedValueOnce({ status: 200, json: { tree: [], truncated: false } } as unknown as RequestUrlResponse) // stale tree, missing a.md
                    .mockResolvedValueOnce({ status: 200, json: { tree: [{ path: 'a.md', type: 'blob', sha: 'blob-a' }], truncated: false } } as unknown as RequestUrlResponse); // fresh tree

                const resultPromise = service.pushBatch([{ path: 'a.md', content: 'hello' }], 'main', 'Push 1 file(s) from Obsidian');
                await vi.runAllTimersAsync();
                const result = await resultPromise;

                expect(result).toEqual([{ path: 'a.md', sha: 'blob-a' }]);
                expect(requestUrl).toHaveBeenCalledTimes(4);
            } finally {
                vi.useRealTimers();
            }
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

        it('deletes N files in one GraphQL mutation via head query -> createCommitOnBranch', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce(headOidResponse('commit1')) // branch head query
                .mockResolvedValueOnce({ status: 200, json: { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } } } as unknown as RequestUrlResponse); // mutation

            await service.deleteBatch(['a.md', 'b.md'], 'main', 'Delete 2 file(s) from Obsidian');

            const calls = vi.mocked(requestUrl).mock.calls.map(c => c[0] as RequestUrlParam);
            expect(calls).toHaveLength(2);
            expect(calls[1]?.url).toBe('https://api.github.com/graphql');

            const mutationBody = JSON.parse(calls[1]?.body as string) as {
                variables: { input: { expectedHeadOid: string; message: { headline: string }; fileChanges: { deletions: Array<{ path: string }> } } };
            };
            const input = mutationBody.variables.input;
            expect(input.expectedHeadOid).toBe('commit1');
            expect(input.message).toEqual({ headline: 'Delete 2 file(s) from Obsidian' });
            expect(input.fileChanges.deletions).toEqual([{ path: 'a.md' }, { path: 'b.md' }]);
        });

        it('throws when the GraphQL response reports errors on an HTTP 200', async () => {
            vi.mocked(requestUrl)
                .mockResolvedValueOnce(headOidResponse('commit1')) // branch head query
                .mockResolvedValueOnce({ status: 200, json: { errors: [{ message: 'Resource not accessible by personal access token' }] } } as unknown as RequestUrlResponse); // mutation failure

            await expect(service.deleteBatch(['a.md'], 'main', 'Delete 1 file(s) from Obsidian'))
                .rejects.toThrow('Resource not accessible by personal access token');
        });

        it('retries with a freshly re-read HEAD when the mutation reports a stale-expectedHeadOid-shaped error', async () => {
            // Regression test for the reported bug: pushing files and immediately
            // batch-deleting them (or vice versa) can read a HEAD that hasn't
            // caught up to the just-completed write yet, so GitHub reports the
            // to-be-deleted path as not existing in that (stale) tree.
            vi.useFakeTimers();
            try {
                vi.mocked(requestUrl)
                    .mockResolvedValueOnce(headOidResponse('stale-commit')) // branch head query (stale)
                    .mockResolvedValueOnce({ status: 200, json: { errors: [{ message: 'A path was requested for deletion, but that path does not exist in tree `stale-commit`' }] } } as unknown as RequestUrlResponse) // mutation fails
                    .mockResolvedValueOnce(headOidResponse('fresh-commit')) // branch head query (fresh, retry)
                    .mockResolvedValueOnce({ status: 200, json: { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } } } as unknown as RequestUrlResponse); // mutation succeeds

                const resultPromise = service.deleteBatch(['a.md'], 'main', 'Delete 1 file(s) from Obsidian');
                await vi.runAllTimersAsync();
                await resultPromise;

                const calls = vi.mocked(requestUrl).mock.calls.map(c => c[0] as RequestUrlParam);
                expect(calls).toHaveLength(4);
                const retryMutation = JSON.parse(calls[3]?.body as string) as { variables: { input: { expectedHeadOid: string } } };
                expect(retryMutation.variables.input.expectedHeadOid).toBe('fresh-commit');
            } finally {
                vi.useRealTimers();
            }
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
