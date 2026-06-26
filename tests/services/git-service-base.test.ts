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

    describe('parseJson with non-JSON (HTML) responses', () => {
        // Simulates Obsidian's real RequestUrlResponse.json getter, which throws
        // SyntaxError when the body is not valid JSON (e.g. an HTML page).
        function htmlResponse(status = 200): RequestUrlResponse {
            return {
                status,
                headers: { 'content-type': 'text/html; charset=utf-8' },
                text: '<!DOCTYPE html><html><body>Login</body></html>',
                get json(): unknown {
                    throw new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON');
                },
            } as unknown as RequestUrlResponse;
        }

        it('getFile: throws a clear error when the server returns an HTML page (2xx)', async () => {
            vi.mocked(requestUrl).mockResolvedValue(htmlResponse(200));
            await expect(service.getFile('test.md', 'main')).rejects.toThrow(/received an HTML page/);
            // The cryptic JSON parse error must not leak through.
            await expect(service.getFile('test.md', 'main')).rejects.not.toThrow(/Unexpected token/);
        });

        it('listFiles: throws a clear error when the server returns an HTML page (2xx)', async () => {
            vi.mocked(requestUrl).mockResolvedValue(htmlResponse(200));
            await expect(service.listFiles('main')).rejects.toThrow(/received an HTML page/);
        });

        it('detects HTML by leading "<" even without an html content-type', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                headers: {},
                text: '  <!DOCTYPE html>...',
                get json(): unknown {
                    throw new SyntaxError("Unexpected token '<'");
                },
            } as unknown as RequestUrlResponse);
            await expect(service.listFiles('main')).rejects.toThrow(/received an HTML page/);
        });

        it('reports a generic JSON parse failure for malformed (non-HTML) JSON', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 200,
                headers: { 'content-type': 'application/json' },
                text: '{ "tree": [',
                get json(): unknown {
                    throw new SyntaxError('Unexpected end of JSON input');
                },
            } as unknown as RequestUrlResponse);
            await expect(service.listFiles('main')).rejects.toThrow(/Failed to parse the Git server response as JSON/);
        });

        it('parseErrorResponse: surfaces a clear message for an HTML error page (>=400)', async () => {
            vi.mocked(requestUrl).mockResolvedValue({
                status: 502,
                headers: { 'content-type': 'text/html' },
                text: '<!DOCTYPE html><html><body>Bad Gateway</body></html>',
                get json(): unknown {
                    throw new SyntaxError("Unexpected token '<'");
                },
            } as unknown as RequestUrlResponse);
            await expect(service.listFiles('main')).rejects.toThrow(/Received an HTML page instead of a JSON error/);
            // The raw HTML document must not be dumped into the message.
            await expect(service.listFiles('main')).rejects.not.toThrow(/DOCTYPE/);
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
