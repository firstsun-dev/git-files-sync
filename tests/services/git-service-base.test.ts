import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService } from '../../src/services/github-service';
import { requestUrl, RequestUrlResponse } from 'obsidian';

// Tests for BaseGitService protected methods exercised via GitHubService
describe('BaseGitService', () => {
    let service: GitHubService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitHubService();
        service.updateConfig('token', 'owner', 'repo');
    });

    describe('getFullPath with rootPath ending in /', () => {
        it('should not double-add slash when rootPath already ends with /', async () => {
            service.updateConfig('token', 'owner', 'repo', 'vault/');
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: { content: btoa('hello'), sha: 'abc' }
            } as unknown as RequestUrlResponse);

            await service.getFile('notes/test.md', 'main');

            const calls = vi.mocked(requestUrl).mock.calls;
            const call = calls[0]?.[0] as { url: string };
            // rootPath 'vault/' + 'notes/test.md' should produce 'vault/notes/test.md'
            expect(call.url).toContain('vault/notes/test.md');
            expect(call.url).not.toContain('vault//notes/test.md');
        });
    });

    describe('safeRequest with non-Error exception', () => {
        it('should wrap non-Error throws in a new Error', async () => {
            // Throw a plain string (not an Error instance) from requestUrl
            vi.mocked(requestUrl).mockRejectedValue('plain string error');

            await expect(service.getFile('test.md', 'main')).rejects.toThrow(
                'Network error or unexpected failure: plain string error'
            );
        });
    });

    describe('encodeContent / decodeContent round-trip', () => {
        it('should correctly encode and decode UTF-8 content', async () => {
            const original = 'Hello, 世界! 🌍';
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                json: {
                    content: { path: 'test.md' }
                }
            } as unknown as RequestUrlResponse);

            // Push encodes content; we verify the encoded body decodes back to original
            await service.pushFile('test.md', original, 'main', 'test');

            const calls = vi.mocked(requestUrl).mock.calls;
            const body = JSON.parse((calls[0]?.[0] as { body: string }).body) as { content: string };
            // Decode what was sent and confirm round-trip
            const decoded = atob(body.content.replace(/\s/g, ''));
            const bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) {
                bytes[i] = decoded.codePointAt(i) ?? 0;
            }
            expect(new TextDecoder().decode(bytes)).toBe(original);
        });
    });
});
