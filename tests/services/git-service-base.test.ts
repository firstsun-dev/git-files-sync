import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService } from '../../src/services/github-service';
import { requestUrl, RequestUrlResponse } from 'obsidian';
import { MAX_BATCH_PUSH_SIZE } from '../../src/services/git-service-base';

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

    describe('safeRequest 404 handling', () => {
        it('getFile returns empty and does not log an error on 404 (e.g. missing .gitignore)', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            vi.mocked(requestUrl).mockResolvedValue({
                status: 404,
                text: 'Not Found',
                json: { message: 'Not Found' },
            } as unknown as RequestUrlResponse);

            const result = await service.getFile('missing/.gitignore', 'main');

            expect(result).toEqual({ content: '', sha: '' });
            // A 404 is an expected "does not exist" probe: never logged as an error…
            expect(errorSpy).not.toHaveBeenCalled();
            // …and logged at most once at debug level (no double-logging).
            expect(debugSpy).toHaveBeenCalledTimes(1);

            errorSpy.mockRestore();
            debugSpy.mockRestore();
        });

        it('still logs non-404 failures as errors', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            vi.mocked(requestUrl).mockResolvedValue({
                status: 500,
                text: 'Internal Server Error',
                json: { message: 'Internal Server Error' },
            } as unknown as RequestUrlResponse);

            await expect(service.listFiles('main')).rejects.toThrow('500');
            expect(errorSpy).toHaveBeenCalledTimes(1);
            errorSpy.mockRestore();
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

    describe('safeRequest when requestUrl() itself throws a JSON-parse-of-HTML error', () => {
        // Some Obsidian versions eagerly parse the response body as JSON inside
        // requestUrl() itself, so a proxy/login HTML page can make the whole
        // call reject with a raw SyntaxError — before `throw: false` or our own
        // status/content-type checks ever get a response object to inspect.
        it('wraps the raw "Unexpected token \'<\'... is not valid JSON" rejection with a clear message', async () => {
            vi.mocked(requestUrl).mockRejectedValue(
                new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON')
            );
            await expect(service.listFiles('main')).rejects.toThrow(/received an HTML page/);
            await expect(service.listFiles('main')).rejects.not.toThrow(/Unexpected token/);
        });

        it('wraps the older V8 phrasing ("Unexpected token < in JSON at position 0") too', async () => {
            vi.mocked(requestUrl).mockRejectedValue(new SyntaxError('Unexpected token < in JSON at position 0'));
            await expect(service.listFiles('main')).rejects.toThrow(/received an HTML page/);
        });

        it('does not misclassify an unrelated JSON syntax error as an HTML response', async () => {
            vi.mocked(requestUrl).mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));
            await expect(service.listFiles('main')).rejects.toThrow('Unexpected end of JSON input');
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

    describe('MAX_BATCH_PUSH_SIZE', () => {
        it('is a sane positive chunk size', () => {
            expect(MAX_BATCH_PUSH_SIZE).toBeGreaterThan(0);
        });
    });

    describe('encodeContent / decodeContent round-trip', () => {
        it('should correctly encode and decode UTF-8 content', async () => {
            const original = 'Hello, 世界! 🌍';
            vi.mocked(requestUrl)
                .mockResolvedValueOnce({ status: 200, json: { object: { sha: 'commit1' } } } as unknown as RequestUrlResponse)
                .mockResolvedValueOnce({ status: 200, json: { data: { createCommitOnBranch: { commit: { oid: 'commit2' } } } } } as unknown as RequestUrlResponse);

            // GraphQL carries the same base64 content as the old Contents API path.
            await service.pushFile('test.md', original, 'main', 'test');

            const calls = vi.mocked(requestUrl).mock.calls;
            const body = JSON.parse((calls[1]?.[0] as { body: string }).body) as { variables: { input: { fileChanges: { additions: Array<{ contents: string }> } } } };
            const decoded = atob(body.variables.input.fileChanges.additions[0]?.contents.replace(/\s/g, '') ?? '');
            const bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) {
                bytes[i] = decoded.codePointAt(i) ?? 0;
            }
            expect(new TextDecoder().decode(bytes)).toBe(original);
        });
    });
});
