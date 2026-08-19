import { beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkspaceLeaf } from 'obsidian';
import { SyncStatusView } from '../../../src/ui/SyncStatusView';
import { SyncStatusController } from '../../../src/ui/sync-status/SyncStatusController';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import type GitLabFilesPush from '../../../src/main';
import { setupObsidianDOM } from '../setup-dom';

describe('SyncStatusView controller wiring', () => {
    beforeAll(() => setupObsidianDOM());

    it('routes refresh and selected batch actions through path-only controller commands', async () => {
        const status = new SyncStatusService();
        status.set({ path: 'a.md', status: 'modified' });
        const commands = {
            refresh: vi.fn().mockResolvedValue(undefined),
            push: vi.fn().mockResolvedValue(undefined),
            pull: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
            openDiff: vi.fn().mockResolvedValue(undefined),
            pushOne: vi.fn().mockResolvedValue(undefined),
            pullOne: vi.fn().mockResolvedValue(undefined),
            deleteLocal: vi.fn().mockResolvedValue(undefined),
            loadDiff: vi.fn().mockResolvedValue(undefined),
            openFile: vi.fn().mockReturnValue(true),
            canOpen: vi.fn().mockReturnValue(true),
            revertMove: vi.fn().mockResolvedValue(undefined),
            pushMoveGroup: vi.fn().mockResolvedValue(undefined),
            revertMoveGroup: vi.fn().mockResolvedValue(undefined),
            pushAllModified: vi.fn().mockResolvedValue(undefined),
            pullAllModified: vi.fn().mockResolvedValue(undefined),
        };
        const plugin = {
            settings: { branch: 'main', vaultFolder: '', rootPath: '' },
            sync: { status },
        } as unknown as GitLabFilesPush;
        const leaf = {
            app: { vault: { getFileByPath: vi.fn().mockReturnValue(null) }, workspace: {} },
        } as unknown as WorkspaceLeaf;
        const view = new SyncStatusView(leaf, plugin, new SyncStatusController(commands));
        (view as unknown as { selectedFiles: Set<string> }).selectedFiles.add('a.md');

        await view.onOpen();
        const root = view.containerEl.children[1] as HTMLElement;
        root.querySelector<HTMLButtonElement>('.ssv-btn-refresh')!.click();
        root.querySelector<HTMLButtonElement>('.ssv-btn-push')!.click();
        root.querySelector<HTMLButtonElement>('.ssv-btn-pull')!.click();
        root.querySelector<HTMLButtonElement>('.ssv-btn-danger')!.click();

        expect(commands.refresh).toHaveBeenCalledOnce();
        expect(commands.push).toHaveBeenCalledWith(['a.md']);
        expect(commands.pull).toHaveBeenCalledWith(['a.md']);
        expect(commands.delete).toHaveBeenCalledWith(['a.md']);
    });
});
