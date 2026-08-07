import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';

/**
 * Minimal real implementation of Obsidian's `requestUrl`, backed by Node's
 * global `fetch`. Production services (BaseGitService subclasses) import
 * `requestUrl` from `obsidian` at module load time; the E2E vitest config
 * aliases the `obsidian` module specifier to this shim (see
 * vitest.e2e.config.ts) instead of the mock in tests/setup.ts, so E2E runs
 * exercise the exact same production code path but over a real network call.
 *
 * Only the subset of RequestUrlParam/RequestUrlResponse that the git
 * services actually use is implemented: url, method, body, headers, and
 * `throw` (defaults to true, matching Obsidian's real behavior).
 */
export async function requestUrl(request: RequestUrlParam | string): Promise<RequestUrlResponse> {
    const params: RequestUrlParam = typeof request === 'string' ? { url: request } : request;
    const shouldThrow = params.throw ?? true;

    const headers: Record<string, string> = { ...params.headers };
    if (params.contentType && !headers['Content-Type']) headers['Content-Type'] = params.contentType;

    const res = await fetch(params.url, {
        method: params.method ?? 'GET',
        headers,
        body: params.body,
    });

    const arrayBuffer = await res.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    let json: unknown;
    try {
        json = text ? JSON.parse(text) : undefined;
    } catch {
        json = undefined;
    }

    const response: RequestUrlResponse = {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        arrayBuffer,
        text,
        json,
    };

    if (shouldThrow && res.status >= 400) {
        const error = new Error(`Request failed, status ${res.status}`);
        (error as Error & { status: number }).status = res.status;
        throw error;
    }

    return response;
}

/**
 * Other `obsidian` exports that production services import only as types
 * (e.g. `RequestUrlResponse`) are erased by TypeScript and need no runtime
 * value here. If a service starts importing another obsidian *value* at
 * module scope, add a minimal real/no-op implementation here rather than
 * pulling in the full tests/setup.ts mock (which is intentionally isolated
 * from E2E — see vitest.e2e.config.ts).
 */
