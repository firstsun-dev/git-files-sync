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
                    json: { content: { path: 'new.md' } } 
                } as unknown as RequestUrlResponse);

            const result = await service.pushFile('new.md', 'new content', 'main', 'create');

            expect(result).toBe('new.md');
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
                json: { content: { path: 'existing.md' } } 
            } as unknown as RequestUrlResponse);

            const result = await service.pushFile('existing.md', 'updated content', 'main', 'update', 'old-sha');

            expect(result).toBe('existing.md');
            const calls = vi.mocked(requestUrl).mock.calls;
            const lastCallParams = calls[calls.length - 1];
            if (!lastCallParams) throw new Error('lastCall is undefined');
            const lastCall = lastCallParams[0] as RequestUrlParam;
            expect(lastCall.method).toBe('PUT');
            expect(lastCall.body).toContain('"sha":"old-sha"');
        });
    });
});
