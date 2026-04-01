/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabService } from '../../src/services/gitlab-service';
import { requestUrl, RequestUrlResponse } from 'obsidian';

vi.mock('obsidian', () => ({
    requestUrl: vi.fn(),
}));

describe('GitLabService', () => {
    let service: GitLabService;
    const baseUrl = 'https://gitlab.com';
    const token = 'test-token';
    const projectId = '123';

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitLabService(baseUrl, token, projectId, '');
    });

    describe('getFile', () => {
        it('should fetch and decode file content correctly', async () => {
                        const mockResponse = {
                status: 200,
                json: {
                    content: btoa(encodeURIComponent('hello world').replace(/%([0-9A-F]{2})/g, (_match, p1: string) => {
                        return String.fromCharCode(parseInt(p1, 16));
                    })),
                    blob_id: 'test-sha'
                }
            };
            vi.mocked(requestUrl).mockResolvedValue(mockResponse as unknown as RequestUrlResponse);

            const result = await service.getFile('test.md', 'main');

            expect(result.content).toBe('hello world');
            expect(result.sha).toBe('test-sha');
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                method: 'GET',
                headers: { 'PRIVATE-TOKEN': token }
            }));
        });

        it('should handle 404 correctly in getFile and return empty content', async () => {
            vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as unknown as RequestUrlResponse);
            const result = await service.getFile('missing.md', 'main');
            expect(result.content).toBe('');
            expect(result.sha).toBe('');
        });

        it('should return blob_id as sha', async () => {
            const mockResponse: any = {
                status: 200,
                json: {
                    content: btoa('test content'),
                    blob_id: 'test-blob-id'
                }
            };
            vi.mocked(requestUrl).mockResolvedValue(mockResponse as unknown as RequestUrlResponse);
            const result = await service.getFile('test.md', 'main');
            expect(result.sha).toBe('test-blob-id');
        });
    });

    describe('pushFile', () => {
        it('should push file content correctly (POST for new file)', async () => {
            // Mock getFile failing (404)
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 404 } as unknown as RequestUrlResponse) // getFile check
                .mockResolvedValueOnce({ status: 201, json: { file_path: 'test.md' } } as unknown as RequestUrlResponse); // push

            const result = await service.pushFile('test.md', 'new content', 'main', 'initial commit');

            expect(result).toBe('test.md');
            expect(requestUrl).toHaveBeenLastCalledWith(expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('bmV3IGNvbnRlbnQ=')
            }));
        });

        it('should push file content correctly (PUT for existing file)', async () => {
            // Mock getFile succeeding
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({
                    status: 200,
                    json: { content: btoa('old'), blob_id: 'old-sha' }
                } as unknown as RequestUrlResponse) // getFile check
                .mockResolvedValueOnce({ status: 200, json: { file_path: 'test.md' } } as unknown as RequestUrlResponse); // push

            const result = await service.pushFile('test.md', 'updated content', 'main', 'update');

            expect(result).toBe('test.md');
            expect(requestUrl).toHaveBeenLastCalledWith(expect.objectContaining({
                method: 'PUT',
                body: expect.stringContaining('dXBkYXRlZCBjb250ZW50')
            }));
        });
    });
});
