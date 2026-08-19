/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { PullExecutor } from '../../../src/logic/sync/PullExecutor';
import type { App } from 'obsidian';
import type { GitLabFilesPushSettings } from '../../../src/settings';

function app() {
    return {
        vault: {
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
});
