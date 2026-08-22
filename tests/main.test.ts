import { describe, it, expect, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import GitLabFilesPush from '../src/main';

describe('GitLabFilesPush.trackFolderRename', () => {
    // Regression test: Obsidian fires exactly one 'rename' event for a moved
    // folder (file is the TFolder itself), not one per contained file. The
    // main.ts handler used to only check `instanceof TFile`, so that single
    // event was silently ignored and nothing under the folder was ever
    // tracked as moved.
    it('tracks every file now under the folder, computing each old path from the folder rename', async () => {
        const files = [
            Object.assign(new TFile(), { path: 'Archive/Projects/a.md' }),
            Object.assign(new TFile(), { path: 'Archive/Projects/sub/b.md' }),
            // Unrelated file elsewhere in the vault — must not be touched.
            Object.assign(new TFile(), { path: 'Elsewhere/c.md' }),
        ];
        const trackRename = vi.fn().mockResolvedValue(undefined);
        const handleFileRenamed = vi.fn();
        const fakePlugin = {
            app: { vault: { getFiles: () => files } },
            sync: { trackRename },
            syncStatusRefresh: { handleFileRenamed },
        };

        const folder = Object.assign(new TFolder(), { path: 'Archive/Projects' });

        await (GitLabFilesPush.prototype as unknown as {
            trackFolderRename(folder: TFolder, oldFolderPath: string): Promise<void>
        }).trackFolderRename.call(fakePlugin, folder, 'Notes/Projects');

        expect(trackRename).toHaveBeenCalledTimes(2);
        expect(trackRename).toHaveBeenCalledWith('Archive/Projects/a.md', 'Notes/Projects/a.md');
        expect(trackRename).toHaveBeenCalledWith('Archive/Projects/sub/b.md', 'Notes/Projects/sub/b.md');
        // The sync panel is notified per file too, so a folder drag updates it
        // live instead of leaving every affected row stale until a manual refresh.
        expect(handleFileRenamed).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no files live under the moved folder', async () => {
        const trackRename = vi.fn().mockResolvedValue(undefined);
        const fakePlugin = {
            app: { vault: { getFiles: () => [] } },
            sync: { trackRename },
            syncStatusRefresh: { handleFileRenamed: vi.fn() },
        };
        const folder = Object.assign(new TFolder(), { path: 'Empty' });

        await (GitLabFilesPush.prototype as unknown as {
            trackFolderRename(folder: TFolder, oldFolderPath: string): Promise<void>
        }).trackFolderRename.call(fakePlugin, folder, 'WasEmpty');

        expect(trackRename).not.toHaveBeenCalled();
    });
});
