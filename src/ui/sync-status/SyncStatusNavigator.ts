import { type App, TFile } from 'obsidian';
import type { FileDiff } from '../../logic/sync/types';
import type { FileStatus } from '../../logic/sync-status-service';
import { DiffView, SYNC_DIFF_VIEW_TYPE } from '../DiffView';

export type SyncStatusOpenTarget =
    | { kind: 'local'; file: TFile }
    | { kind: 'remote'; url: string };

export interface DiffWorkspace {
    getDiff(path: string): Promise<FileDiff>;
    getRemoteFileUrl(path: string): string | null;
}

/** Owns Obsidian navigation and diff-pane presentation for sync-status rows. */
export class SyncStatusNavigator {
    constructor(
        private readonly app: App,
        private readonly workspace: DiffWorkspace,
    ) {}

    targetFor(status: FileStatus): SyncStatusOpenTarget | null {
        if (status.status === 'remote-only') {
            const url = this.workspace.getRemoteFileUrl(status.path);
            return url ? { kind: 'remote', url } : null;
        }
        const file = status.file ?? this.app.vault.getFileByPath(status.path);
        return file instanceof TFile ? { kind: 'local', file } : null;
    }

    openFile(status: FileStatus, newLeaf: boolean): boolean {
        const target = this.targetFor(status);
        if (!target) return false;
        if (target.kind === 'local') void this.app.workspace.getLeaf(newLeaf).openFile(target.file);
        else window.open(target.url, '_blank');
        return true;
    }

    async loadDiff(path: string): Promise<void> {
        await this.workspace.getDiff(path);
    }

    async openDiff(path: string): Promise<void> {
        const diff = await this.workspace.getDiff(path);
        const existing = this.app.workspace.getLeavesOfType(SYNC_DIFF_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getLeaf('tab');
        if (!existing) await leaf.setViewState({ type: SYNC_DIFF_VIEW_TYPE, active: true });
        if (leaf.view instanceof DiffView) leaf.view.setDiff(diff);
        await this.app.workspace.revealLeaf(leaf);
    }

    closeDiffFor(paths: Iterable<string>): void {
        const changed = new Set(paths);
        for (const leaf of this.app.workspace.getLeavesOfType(SYNC_DIFF_VIEW_TYPE)) {
            const shown = leaf.view instanceof DiffView ? leaf.view.getPath() : null;
            if (shown !== null && changed.has(shown)) leaf.detach();
        }
    }
}
