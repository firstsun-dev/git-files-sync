// Real `requestUrl` shim for E2E: production services import this from
// `obsidian` (see vitest.e2e.config.ts's `alias`), and E2E suites need actual
// network calls to reach the provisioned provider — the `vi.fn()` mock
// tests/setup.ts installs for unit tests is deliberately not used here.
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';

export async function requestUrl(request: RequestUrlParam | string): Promise<RequestUrlResponse> {
    const params: RequestUrlParam = typeof request === 'string' ? { url: request } : request;
    const shouldThrow = params.throw ?? true;
    const headers: Record<string, string> = { ...params.headers };
    if (params.contentType && !headers['Content-Type']) headers['Content-Type'] = params.contentType;
    const res = await fetch(params.url, { method: params.method ?? 'GET', headers, body: params.body });
    const arrayBuffer = await res.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    const response: RequestUrlResponse = { status: res.status, headers: Object.fromEntries(res.headers.entries()), arrayBuffer, text, json };
    if (shouldThrow && res.status >= 400) {
        const error = new Error(`Request failed, status ${res.status}`);
        (error as Error & { status: number }).status = res.status;
        throw error;
    }
    return response;
}

export class Modal {
    app: unknown;
    constructor(app?: unknown) { this.app = app; }
    open(): void {}
    close(): void {}
}
export class PluginSettingTab { constructor(_app?: unknown, _plugin?: unknown) {} }
export class TextComponent {}
export class AbstractInputSuggest<_T> { constructor(_app: unknown, _inputEl: unknown) {} }
export class TFolder { path: string; constructor(path: string) { this.path = path; } }
export class Setting { constructor(_containerEl?: unknown) {} }
export class TFile {
    path: string;
    name: string;
    constructor(path: string) { this.path = path; this.name = path.split('/').pop() ?? path; }
}
export class Notice {
    constructor(_message?: string, _timeout?: number) {}
    setMessage(): this { return this; }
    hide(): void {}
}
export const Platform = { isDesktopApp: false, isMobile: false };
export class FileSystemAdapter { getBasePath(): string { return '/e2e/fake-vault'; } }
