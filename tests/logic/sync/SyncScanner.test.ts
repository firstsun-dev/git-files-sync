import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { GitLabFilesPushSettings } from '../../../src/settings';
import { SyncScanner } from '../../../src/logic/sync/SyncScanner';

function scanner(settings: Partial<GitLabFilesPushSettings> = {}) {
    const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue('text'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
    };
    const app = { vault: { adapter, getFileByPath: vi.fn() } } as unknown as App;
    return { adapter, scanner: new SyncScanner(app, { vaultFolder: '', rootPath: '', ...settings } as GitLabFilesPushSettings) };
}

describe('SyncScanner', () => {
    it.each([
        [{ vaultFolder: '' }, 'Notes/a.md', 'Notes/a.md'],
        [{ vaultFolder: 'Vault' }, 'Vault/Notes/a.md', 'Notes/a.md'],
        [{ vaultFolder: 'Vault' }, 'Vault', ''],
    ] as const)('maps vault paths to repository paths', (settings, path, expected) => {
        expect(scanner(settings).scanner.toRepoPath(path)).toBe(expected);
    });

    it('maps repository paths to full tree paths exactly once', () => {
        const subject = scanner({ rootPath: 'docs/' }).scanner;

        expect(subject.toTreePath('a.md')).toBe('docs/a.md');
        expect(subject.toTreePath('docs/a.md')).toBe('docs/a.md');
        expect(subject.toTreePath('/docs/a.md')).toBe('docs/a.md');
    });

    it('reads hidden text and binary paths through the adapter', async () => {
        const { scanner: subject, adapter } = scanner();

        await expect(subject.readContent('.hidden/config')).resolves.toBe('text');
        await expect(subject.readContent('.hidden/icon.png')).resolves.toBeInstanceOf(ArrayBuffer);
        expect(adapter.read).toHaveBeenCalledWith('.hidden/config');
        expect(adapter.readBinary).toHaveBeenCalledWith('.hidden/icon.png');
    });
});
