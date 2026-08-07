import type { App } from 'obsidian';
import { TFile } from './obsidian-request-url';

/**
 * Real in-memory Obsidian Vault/App stand-in for SyncManager E2E (see
 * e2e/suites/sync-manager.e2e.test.ts) — not a `vi.fn()` mock. The point of
 * SyncManager E2E is to exercise real `SyncManager` + real provider service
 * code against a real Git server; the *only* thing worth faking is the
 * Obsidian filesystem boundary, so this implements exactly the `vault`/
 * `vault.adapter` surface `src/logic/sync-manager.ts` actually touches
 * (confirmed by reading it) as a plain `Map<path, content>`.
 */
export class FakeVault {
    private readonly files = new Map<string, string | ArrayBuffer>();

    /** Seeds local vault state directly, bypassing any sync logic. */
    writeLocal(path: string, content: string | ArrayBuffer): void {
        this.files.set(path, content);
    }

    has(path: string): boolean {
        return this.files.has(path);
    }

    /** Mirrors what Obsidian does on a vault rename: same content, new path. */
    renameLocal(oldPath: string, newPath: string): void {
        const content = this.files.get(oldPath);
        if (content === undefined) throw new Error(`fake vault: no local file at ${oldPath}`);
        this.files.delete(oldPath);
        this.files.set(newPath, content);
    }

    readonly adapter = {
        exists: async (path: string): Promise<boolean> => this.files.has(path),
        read: async (path: string): Promise<string> => {
            const content = this.files.get(path);
            if (typeof content !== 'string') throw new Error(`fake vault: no text file at ${path}`);
            return content;
        },
        readBinary: async (path: string): Promise<ArrayBuffer> => {
            const content = this.files.get(path);
            if (!(content instanceof ArrayBuffer)) throw new Error(`fake vault: no binary file at ${path}`);
            return content;
        },
        write: async (path: string, content: string): Promise<void> => {
            this.files.set(path, content);
        },
        writeBinary: async (path: string, content: ArrayBuffer): Promise<void> => {
            this.files.set(path, content);
        },
        // ensureParentDirs (src/utils/vault-path.ts) tolerates mkdir failures;
        // there are no real directories to create in an in-memory map.
        mkdir: async (): Promise<void> => {},
    };

    readonly vault = {
        read: async (file: TFile): Promise<string> => this.adapter.read(file.path),
        readBinary: async (file: TFile): Promise<ArrayBuffer> => this.adapter.readBinary(file.path),
        modify: async (file: TFile, content: string): Promise<void> => {
            this.files.set(file.path, content);
        },
        modifyBinary: async (file: TFile, content: ArrayBuffer): Promise<void> => {
            this.files.set(file.path, content);
        },
        getFileByPath: (path: string): TFile | null => (this.files.has(path) ? new TFile(path) : null),
        adapter: this.adapter,
    };
}

/** Casts a FakeVault into the shape SyncManager expects as its `App` — it only ever touches `app.vault.*`. */
export function fakeApp(fakeVault: FakeVault): App {
    return { vault: fakeVault.vault } as unknown as App;
}
