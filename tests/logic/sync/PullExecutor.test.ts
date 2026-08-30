/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() mocks intentionally reference methods unbound; safe under Vitest's mocking model */
import { describe, expect, it, vi } from 'vitest';
import { PullExecutor } from '../../../src/logic/sync/PullExecutor';
import { TFile, type App } from 'obsidian';
import type { GitLabFilesPushSettings } from '../../../src/settings';

function app(files: Record<string, TFile> = {}) {
    return {
        vault: {
            getFileByPath: vi.fn((path: string) => files[path] ?? null),
            adapter: {
                exists: vi.fn().mockResolvedValue(true),
                mkdir: vi.fn().mockResolvedValue(undefined),
                write: vi.fn().mockResolvedValue(undefined),
                writeBinary: vi.fn().mockResolvedValue(undefined),
            },
            modify: vi.fn().mockResolvedValue(undefined),
            modifyBinary: vi.fn().mockResolvedValue(undefined),
        },
    } as unknown as App;
}

const settings = { symlinkHandling: 'follow' } as unknown as GitLabFilesPushSettings;

describe('PullExecutor', () => {
    it('writes text through the adapter before updating metadata', async () => {
        const mockApp = app();
        const updateMetadata = vi.fn().mockResolvedValue(undefined);
        const executor = new PullExecutor(mockApp, settings, updateMetadata, () => 'GitHub');

        await executor.pull({ path: 'Folder/a.md', name: 'a.md' }, 'remote', 'sha', true);

        expect(mockApp.vault.adapter.write).toHaveBeenCalledWith('Folder/a.md', 'remote');
        expect(updateMetadata).toHaveBeenCalledWith('Folder/a.md', 'sha');
    });

    it('preserves binary content and propagates vault write failures', async () => {
        const mockApp = app();
        vi.mocked(mockApp.vault.adapter.writeBinary).mockRejectedValue(new Error('disk full'));
        const updateMetadata = vi.fn();
        const executor = new PullExecutor(mockApp, settings, updateMetadata, () => 'GitHub');
        const content = new Uint8Array([1, 2]).buffer;

        await expect(executor.pull({ path: 'image.png', name: 'image.png' }, content, 'sha', true)).rejects.toThrow('disk full');
        expect(updateMetadata).not.toHaveBeenCalled();
    });

    it('writes a remote symlink target as content when real links are disabled', async () => {
        const mockApp = app();
        const executor = new PullExecutor(mockApp, settings, vi.fn(), () => 'GitHub');

        await executor.pull({ path: 'link', name: 'link' }, 'blob-content', 'sha', true, '../target');

        expect(mockApp.vault.adapter.write).toHaveBeenCalledWith('link', '../target');
    });

    it('modifies an existing TFile in place instead of writing through the adapter', async () => {
        const existing = Object.assign(new TFile(), { path: 'existing.md', name: 'existing.md' });
        const mockApp = app({ 'existing.md': existing });
        const updateMetadata = vi.fn().mockResolvedValue(undefined);
        const executor = new PullExecutor(mockApp, settings, updateMetadata, () => 'GitHub');

        await executor.pull({ path: 'existing.md', name: 'existing.md' }, 'REMOTE', 'remote-sha', true);

        expect(mockApp.vault.modify).toHaveBeenCalledWith(existing, 'REMOTE');
        expect(mockApp.vault.adapter.write).not.toHaveBeenCalled();
        expect(updateMetadata).toHaveBeenCalledWith('existing.md', 'remote-sha');
    });

    it('writes a missing text file through the adapter', async () => {
        const mockApp = app();
        const updateMetadata = vi.fn().mockResolvedValue(undefined);
        const executor = new PullExecutor(mockApp, settings, updateMetadata, () => 'GitHub');

        await executor.pull({ path: 'missing.md', name: 'missing.md' }, 'REMOTE', 'remote-sha', true);

        expect(mockApp.vault.adapter.write).toHaveBeenCalledWith('missing.md', 'REMOTE');
        expect(mockApp.vault.modify).not.toHaveBeenCalled();
        expect(updateMetadata).toHaveBeenCalledWith('missing.md', 'remote-sha');
    });

    it('modifies an existing TFile as binary in place', async () => {
        const existing = Object.assign(new TFile(), { path: 'image.png', name: 'image.png' });
        const mockApp = app({ 'image.png': existing });
        const updateMetadata = vi.fn().mockResolvedValue(undefined);
        const executor = new PullExecutor(mockApp, settings, updateMetadata, () => 'GitHub');
        const content = new Uint8Array([9, 8, 7]).buffer;

        await executor.pull(existing, content, 'remote-sha', true);

        expect(mockApp.vault.modifyBinary).toHaveBeenCalledWith(existing, content);
        expect(mockApp.vault.adapter.writeBinary).not.toHaveBeenCalled();
        expect(updateMetadata).toHaveBeenCalledWith('image.png', 'remote-sha');
    });

    it('writes a missing binary file through the adapter', async () => {
        const mockApp = app();
        const updateMetadata = vi.fn().mockResolvedValue(undefined);
        const executor = new PullExecutor(mockApp, settings, updateMetadata, () => 'GitHub');
        const content = new Uint8Array([1, 2, 3]).buffer;

        await executor.pull({ path: 'missing.png', name: 'missing.png' }, content, 'remote-sha', true);

        expect(mockApp.vault.adapter.writeBinary).toHaveBeenCalledWith('missing.png', content);
        expect(mockApp.vault.modifyBinary).not.toHaveBeenCalled();
        expect(updateMetadata).toHaveBeenCalledWith('missing.png', 'remote-sha');
    });
});

/* eslint-enable @typescript-eslint/unbound-method -- re-enable after the whole-file exemption above */
