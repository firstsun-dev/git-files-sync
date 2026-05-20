import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabService } from '../../src/services/gitlab-service';
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

        it('should push file content correctly (PUT for existing file)', async () => {
            mockRequest({ status: 200, json: { file_path: 'test.md' } });
            const result = await service.pushFile('test.md', 'updated content', 'main', 'update', 'old-sha');
            expect(result).toEqual({ path: 'test.md' });
            const call = getLastRequestCall();
            expect(call.method).toBe('PUT');
            expect(call.body).toContain(btoa('updated content'));
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

        it('should not match sibling paths with same prefix as rootPath', async () => {
            service.updateConfig(baseUrl, token, projectId, 'src/content');
            mockRequest({ status: 200, json: [
                { path: 'src/content/index.md', type: 'blob' },
                { path: 'src/content.config.ts', type: 'blob' },
                { path: 'src/contentful.ts', type: 'blob' },
            ] });
            expect(await service.listFiles('main')).toEqual(['src/content/index.md']);
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
    });

    describe('getRepoGitignores', () => {
        sharedGetRepoGitignores(() => service, 'json');
    });

    describe('getFile error handling', () => {
        sharedGetFileErrorHandling(() => service);
    });
});
