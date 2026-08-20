import type { FileStatus } from '../../logic/sync-status-service';

export interface SyncStatusCommandPort {
    refresh(): Promise<void>;
    push(paths: readonly string[]): Promise<void>;
    pull(paths: readonly string[]): Promise<void>;
    delete(paths: readonly string[]): Promise<void>;
    openDiff(path: string): Promise<void>;
    pushOne(status: FileStatus): Promise<void>;
    pullOne(status: FileStatus): Promise<void>;
    deleteLocal(status: FileStatus): Promise<void>;
    loadDiff(path: string): Promise<void>;
    openFile(status: FileStatus, newLeaf: boolean): boolean;
    canOpen(status: FileStatus): boolean;
    revertMove(status: FileStatus): Promise<void>;
    pushMoveGroup(members: FileStatus[]): Promise<void>;
    revertMoveGroup(members: FileStatus[]): Promise<void>;
    pushAllModified(): Promise<void>;
    pullAllModified(): Promise<void>;
}

/** Converts view events into path-only workspace commands. */
export class SyncStatusController {
    constructor(private readonly commands: SyncStatusCommandPort) {}

    refresh(): Promise<void> {
        return this.commands.refresh();
    }

    push(paths: readonly string[]): Promise<void> {
        return this.commands.push(paths);
    }

    pull(paths: readonly string[]): Promise<void> {
        return this.commands.pull(paths);
    }

    delete(paths: readonly string[]): Promise<void> {
        return this.commands.delete(paths);
    }

    openDiff(path: string): Promise<void> {
        return this.commands.openDiff(path);
    }

    pushOne(status: FileStatus): Promise<void> { return this.commands.pushOne(status); }
    pullOne(status: FileStatus): Promise<void> { return this.commands.pullOne(status); }
    deleteLocal(status: FileStatus): Promise<void> { return this.commands.deleteLocal(status); }
    loadDiff(path: string): Promise<void> { return this.commands.loadDiff(path); }
    openFile(status: FileStatus, newLeaf: boolean): boolean { return this.commands.openFile(status, newLeaf); }
    canOpen(status: FileStatus): boolean { return this.commands.canOpen(status); }
    revertMove(status: FileStatus): Promise<void> { return this.commands.revertMove(status); }
    pushMoveGroup(members: FileStatus[]): Promise<void> { return this.commands.pushMoveGroup(members); }
    revertMoveGroup(members: FileStatus[]): Promise<void> { return this.commands.revertMoveGroup(members); }
    pushAllModified(): Promise<void> { return this.commands.pushAllModified(); }
    pullAllModified(): Promise<void> { return this.commands.pullAllModified(); }
}
