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
 *
 * The SyncManager E2E suite (e2e/suites/sync-manager.e2e.test.ts) pulls in
 * `src/logic/sync-manager.ts` and its transitive imports, which need a
 * handful of these as real runtime values, not just types:
 *
 * - `TFile`: `sync-manager.ts` does `fileOrPath instanceof TFile`, so this
 *   must be a real class, not erased.
 * - `Notice`: constructed directly (`new Notice(...)`) for user-facing
 *   messages; a no-op is fine since E2E has no UI to show them in.
 * - `Platform` / `FileSystemAdapter`: `src/utils/symlink.ts` checks
 *   `app.vault.adapter instanceof FileSystemAdapter` to decide whether real
 *   OS symlinks are available. The E2E fake vault's adapter (see
 *   e2e/shim/fake-vault.ts) is never an instance of this class, so real
 *   symlink handling correctly no-ops and falls back to content-based sync
 *   — exercising the same code path unit tests already cover, not
 *   reimplementing symlink creation for E2E.
 *
 * `SyncConflictModal`/`SyncPlanModal` are `vi.mock('...SyncPlanModal')`-style
 * bare-automocked by the SyncManager suite, same pattern as
 * tests/logic/sync-manager.test.ts. Automocking still loads the real module
 * once to learn its shape, and both classes do `class X extends Modal` at
 * top level, so `Modal` must be a real class here too (their method bodies,
 * which reference `Setting`/`ButtonComponent`/`setIcon`, are never executed
 * by automocking — only introspected — so those don't strictly need it, but
 * `Setting` is included below anyway since `src/settings-implementation.ts`
 * needs it for the same reason as `PluginSettingTab`/`TextComponent`, next).
 *
 * `sync-manager.ts` also imports plain functions (`getServiceName`,
 * `getEffectiveSymlinkHandling`, ...) from `../settings`, a *value* import —
 * unlike a type-only import, this forces Node to fully evaluate
 * `src/settings.ts` -> `src/settings-implementation.ts` (which bundles those
 * pure functions in the same file as the `GitLabSyncSettingTab` UI class) ->
 * `src/ui/FolderSuggest.ts`, pulling in `PluginSettingTab`, `TextComponent`,
 * `AbstractInputSuggest`, and `TFolder` as real top-level `class X extends Y`
 * values too, even though the SyncManager E2E suite never triggers the
 * settings UI itself. Splitting those pure functions out of
 * settings-implementation.ts to avoid this is a bigger production-code
 * change than this E2E harness should make; stubbing the shape here is the
 * narrower fix.
 */
export class Modal {
    app: unknown;
    constructor(app?: unknown) { this.app = app; }
    open(): void {}
    close(): void {}
}

export class PluginSettingTab {
    constructor(_app?: unknown, _plugin?: unknown) {}
}
export class TextComponent {}
export class AbstractInputSuggest<_T> {
    constructor(_app: unknown, _inputEl: unknown) {}
}
export class TFolder {
    path: string;
    constructor(path: string) { this.path = path; }
}
export class Setting {
    constructor(_containerEl?: unknown) {}
}

export class TFile {
    path: string;
    name: string;
    constructor(path: string) {
        this.path = path;
        this.name = path.split('/').pop() ?? path;
    }
}

export class Notice {
    constructor(_message?: string, _timeout?: number) {}
    setMessage(): this { return this; }
    hide(): void {}
}

export const Platform = { isDesktopApp: false, isMobile: false };

export class FileSystemAdapter {
    getBasePath(): string { return '/e2e/fake-vault'; }
}
