import { TFile, type App } from 'obsidian';
import type { GitLabFilesPushSettings } from '../../settings';
import { getEffectiveSymlinkHandling } from '../../settings';
import { createLocalSymlink } from '../../utils/symlink';
import { ensureParentDirs } from '../../utils/vault-path';

export interface PullFileTarget {
    path: string;
    name: string;
}

/** Executes one vault-side pull mutation; conflict decisions remain outside. */
export class PullExecutor {
    constructor(
        private readonly app: App,
        private readonly settings: GitLabFilesPushSettings,
        private readonly updateMetadata: (path: string, sha: string) => Promise<void>,
        private readonly getServiceName: () => string,
        private readonly notify: (message: string) => void = () => undefined,
    ) {}

    async pull(
        file: TFile | PullFileTarget,
        remoteContent: string | ArrayBuffer,
        remoteSha: string,
        silent = false,
        symlinkTarget?: string,
    ): Promise<void> {
        await ensureParentDirs(this.app.vault.adapter, file.path);

        if (symlinkTarget !== undefined) {
            if (
                getEffectiveSymlinkHandling(this.settings) === 'real'
                && createLocalSymlink(this.app, file.path, symlinkTarget)
            ) {
                await this.updateMetadata(file.path, remoteSha);
                if (!silent) this.notify(`Pulled symlink ${file.name} from ${this.getServiceName()}`);
                return;
            }
            remoteContent = symlinkTarget;
        }

        await this.write(file, remoteContent);
        await this.updateMetadata(file.path, remoteSha);
        if (!silent) this.notify(`Pulled ${file.name} from ${this.getServiceName()}`);
    }

    private async write(target: TFile | PullFileTarget, content: string | ArrayBuffer): Promise<void> {
        const file = this.app.vault.getFileByPath(target.path) ?? target;
        if (typeof content !== 'string') {
            if (file instanceof TFile) await this.app.vault.modifyBinary(file, content);
            else await this.app.vault.adapter.writeBinary(file.path, content);
            return;
        }
        if (file instanceof TFile) await this.app.vault.modify(file, content);
        else await this.app.vault.adapter.write(file.path, content);
    }
}
