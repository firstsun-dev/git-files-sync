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

    describe('startup behavior', () => {
        function callLayoutReady(fakePlugin: Record<string, unknown>): void {
            (GitLabFilesPush.prototype as unknown as {
                handleLayoutReady(this: unknown): void;
            }).handleLayoutReady.call(fakePlugin);
        }

        it('runs background automatic sync and does NOT open Source Control when enabled + on startup', () => {
            const runOnce = vi.fn().mockResolvedValue(undefined);
            const refresh = vi.fn().mockResolvedValue(undefined);
            const activateSourceControlView = vi.fn().mockResolvedValue(undefined);
            const fakePlugin = {
                settings: { automaticSyncEnabled: true, automaticSyncOnStartup: true, autoRefreshOnStartup: true },
                automaticSync: { runOnce },
                sourceControlViewModel: { refresh },
                activateSourceControlView,
                normalizeSourceControlLeaves: vi.fn(),
            };

            callLayoutReady(fakePlugin);

            expect(runOnce).toHaveBeenCalledTimes(1);
            // No redundant legacy startup refresh / view reveal.
            expect(activateSourceControlView).not.toHaveBeenCalled();
            expect(refresh).not.toHaveBeenCalled();
        });

        it('falls back to the existing refresh-on-startup behavior when automatic sync is off', () => {
            const runOnce = vi.fn().mockResolvedValue(undefined);
            const fakePlugin = {
                settings: { automaticSyncEnabled: false, automaticSyncOnStartup: true, autoRefreshOnStartup: true },
                automaticSync: { runOnce },
                // refreshSyncStatusOnStartup is a prototype method; stub the two
                // calls it makes on this object.
                sourceControlViewModel: { refresh: vi.fn().mockResolvedValue(undefined) },
                activateSourceControlView: vi.fn().mockResolvedValue(undefined),
                normalizeSourceControlLeaves: vi.fn(),
            };
            (fakePlugin as Record<string, unknown>).refreshSyncStatusOnStartup =
                (GitLabFilesPush.prototype as unknown as Record<string, unknown>).refreshSyncStatusOnStartup;

            callLayoutReady(fakePlugin);

            expect(runOnce).not.toHaveBeenCalled();
            expect(fakePlugin.activateSourceControlView).toHaveBeenCalledTimes(1);
        });

        it('does nothing at startup when both automatic sync and refresh-on-startup are off', () => {
            const runOnce = vi.fn();
            const activateSourceControlView = vi.fn();
            const fakePlugin = {
                settings: { automaticSyncEnabled: false, automaticSyncOnStartup: false, autoRefreshOnStartup: false },
                automaticSync: { runOnce },
                sourceControlViewModel: { refresh: vi.fn() },
                activateSourceControlView,
                normalizeSourceControlLeaves: vi.fn(),
            };

            callLayoutReady(fakePlugin);

            expect(runOnce).not.toHaveBeenCalled();
            expect(activateSourceControlView).not.toHaveBeenCalled();
        });
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
