import { it, expect, vi } from 'vitest';
import { requestUrl, RequestUrlResponse, RequestUrlParam } from 'obsidian';
import type { GitServiceInterface } from '../../src/services/git-service-interface';

export function getLastRequestCall(): RequestUrlParam {
    const calls = vi.mocked(requestUrl).mock.calls;
    const last = calls[calls.length - 1];
    if (!last) throw new Error('requestUrl was not called');
    return last[0] as RequestUrlParam;
}

export function mockRequest(response: Partial<RequestUrlResponse>): void {
    vi.mocked(requestUrl).mockResolvedValue(response as RequestUrlResponse);
}

export function sharedTestConnection(getService: () => GitServiceInterface): void {
    it('should report repoOk and branchOk on successful connection', async () => {
        mockRequest({ status: 200, json: {} });
        expect(await getService().testConnection('main')).toEqual({ repoOk: true, branchOk: true });
    });

    it('should report repoOk: false on failed connection', async () => {
        mockRequest({ status: 401, json: { message: 'Unauthorized' }, text: 'Unauthorized' });
        const result = await getService().testConnection('main');
        expect(result.repoOk).toBe(false);
        expect(result.branchOk).toBe(false);
    });
}

export function sharedGetFileErrorHandling(getService: () => GitServiceInterface): void {
    it('should rethrow non-404 errors', async () => {
        mockRequest({ status: 500, json: { message: 'Internal Server Error' }, text: 'Internal Server Error' });
        await expect(getService().getFile('test.md', 'main')).rejects.toThrow('500');
    });
}

export function sharedGetRepoGitignores(getService: () => GitServiceInterface, treeKey: 'tree' | 'json'): void {
    it('should return only .gitignore paths from file list', async () => {
        const items = [
            { path: '.gitignore', type: 'blob' },
            { path: 'src/main.ts', type: 'blob' },
            { path: 'sub/.gitignore', type: 'blob' },
        ];
        mockRequest({ status: 200, json: treeKey === 'tree' ? { tree: items } : items });
        expect(await getService().getRepoGitignores('main')).toEqual(['.gitignore', 'sub/.gitignore']);
    });
}
