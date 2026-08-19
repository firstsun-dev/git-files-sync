/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { SyncStatusController, type SyncStatusCommandPort } from '../../../src/ui/sync-status/SyncStatusController';
import type { FileStatus } from '../../../src/logic/sync-status-service';

function setup() {
    const commands: SyncStatusCommandPort = {
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
    return { commands, controller: new SyncStatusController(commands) };
}

describe('SyncStatusController', () => {
    it('forwards refresh to the workspace command boundary', async () => {
        const { commands, controller } = setup();
        await controller.refresh();
        expect(commands.refresh).toHaveBeenCalledOnce();
    });

    it.each(['push', 'pull', 'delete'] as const)('forwards selected paths to %s unchanged', async command => {
        const { commands, controller } = setup();
        await controller[command](['a.md', 'Folder/b.md']);
        expect(commands[command]).toHaveBeenCalledWith(['a.md', 'Folder/b.md']);
    });

    it('opens a diff by path without exposing provider details', async () => {
        const { commands, controller } = setup();
        await controller.openDiff('a.md');
        expect(commands.openDiff).toHaveBeenCalledWith('a.md');
    });

    it.each([
        ['pushOne', 'pushOne'],
        ['pullOne', 'pullOne'],
        ['deleteLocal', 'deleteLocal'],
        ['revertMove', 'revertMove'],
    ] as const)('forwards a row to %s', async (controllerMethod, portMethod) => {
        const { commands, controller } = setup();
        const status: FileStatus = { path: 'a.md', status: 'modified' };

        await controller[controllerMethod](status);

        expect(commands[portMethod]).toHaveBeenCalledWith(status);
    });

    it('forwards move groups without converting them to provider objects', async () => {
        const { commands, controller } = setup();
        const members: FileStatus[] = [{ path: 'new/a.md', movedFrom: 'old/a.md', status: 'moved' }];

        await controller.pushMoveGroup(members);
        await controller.revertMoveGroup(members);

        expect(commands.pushMoveGroup).toHaveBeenCalledWith(members);
        expect(commands.revertMoveGroup).toHaveBeenCalledWith(members);
    });
});
