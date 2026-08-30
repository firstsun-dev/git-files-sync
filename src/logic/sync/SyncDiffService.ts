import type { SyncStatusService } from '../sync-status-service';
import { isBinaryPath } from '../../utils/path';
import type { FileDiff } from './types';
import { computeDiffStat } from '../../ui/source-control/ChangePresentation';
import type { DiffStatLoadResult } from '../../ui/source-control/DiffStatProvider';

export type BlobReader = (sha: string, path: string) => Promise<{ content: string | ArrayBuffer }>;

/** Cache key for an in-flight remote blob fetch: the blob identifies the content, not just the path. */
function remoteContentKey(remoteSha: string, path: string): string {
    return `${remoteSha}:${path}`;
}

/**
 * Builds the only diff DTO exposed across the UI/domain boundary.
 *
 * `getDiff` also defines one-sided diff semantics for the diff pane, so the
 * UI never has to branch per change kind when rendering sides:
 * - `local-only` (A): remote side renders as '' — everything in the local
 *   content shows as +N additions in the pane.
 * - `remote-only` (↓) / `local-deleted` (D): local side renders as '' — the
 *   remote content relands entirely with no phantom deletions, and no
 *   separate blob-download round-trip per consumer.
 * - two-sided kinds (`modified` / `moved`): both sides as stored.
 *
 * NOTE: the FileDiff sides are the PANE's semantics (what you'd see after
 * the action), not the row stat's direction. Both one-sided remote kinds
 * produce local=''/remote=content, which a plain LCS count reads as -N; the
 * row stat instead applies the UX direction (+N for a download, -N for a
 * local deletion) in `SourceControlItemView.loadDiffStat` via
 * `addedContentStat`/`deletedContentStat`.
 *
 * Concurrent requests for the same remote blob (a background stat loader
 * racing a user-opened diff) are coalesced onto one `readBlob` call by an
 * in-flight memoization keyed by `remoteSha:path`; the entry is reaped when
 * the shared promise settles.
 */
export class SyncDiffService {
    /** In-flight remote blob reads, keyed by `remoteSha:path`, so concurrent consumers share one fetch. */
    private readonly pendingRemoteContent = new Map<string, Promise<string | ArrayBuffer>>();

    constructor(
        private readonly statuses: SyncStatusService,
        private readonly readBlob: BlobReader,
    ) {}

    async getDiff(path: string): Promise<FileDiff> {
        const status = this.statuses.get(path);
        if (!status) throw new Error(`No sync status for ${path}`);

        const remoteContent = await this.resolveRemoteContent(status);
        let kind: FileDiff['kind'] = 'text';
        if (status.isSymlink) kind = 'symlink';
        else if (isBinaryPath(status.path)) kind = 'binary';

        // One-sided semantics: whichever side doesn't exist renders empty so
        // a one-sided stat computes as pure additions (+N) without either
        // consumer (diff pane or stat loader) special-casing the kind.
        const localExists = status.status !== 'remote-only' && status.status !== 'local-deleted';
        const remoteExists = status.status !== 'unsynced';
        return {
            path: status.path,
            localContent: localExists ? status.localContent ?? '' : '',
            remoteContent: remoteExists ? remoteContent ?? '' : '',
            kind,
        };
    }

    /**
     * Resolves the +/- diff stat for one batch-conflict row — the data side
     * of the conflict modal's `ConflictDiffStatLoader` (the modal itself
     * stays presentation-only; SyncDiffService owns remote/local diff data).
     *
     * Binary (by path or by actual `ArrayBuffer` content) files have no
     * line diff and are terminally `unavailable`; non-string content ditto.
     * Text conflicts fetch the reviewed remote blob by SHA (sharing the
     * in-flight memoization with `getDiff`, so a stat racing a user-opened
     * diff is one round-trip) and count additions/deletions with the same
     * `computeDiffStat` the Source Control rows use.
     */
    async getConflictStat(conflict: {
        path: string;
        localContent: string | ArrayBuffer;
        remoteSha: string;
        repoPath: string;
    }): Promise<DiffStatLoadResult> {
        if (isBinaryPath(conflict.path) || typeof conflict.localContent !== 'string') {
            return { status: 'unavailable' };
        }
        const remoteContent = await this.resolveRemoteContent({
            path: conflict.path,
            status: 'conflict',
            remoteSha: conflict.remoteSha,
            movedFrom: conflict.repoPath,
        });
        if (typeof remoteContent !== 'string') {
            return { status: 'unavailable' };
        }
        return { status: 'ready', stat: computeDiffStat(remoteContent, conflict.localContent) };
    }

    /** Fetches the remote blob once per `remoteSha:path`, coalescing concurrent consumers. */
    private async resolveRemoteContent(status: {
        path: string;
        status: string;
        remoteContent?: string | ArrayBuffer;
        remoteSha?: string;
        movedFrom?: string;
    }): Promise<string | ArrayBuffer | undefined> {
        if (status.remoteContent !== undefined) return status.remoteContent;
        if (!status.remoteSha) {
            // A one-sided local row has no remote content to fetch — its
            // diff side resolves to empty rather than staying undefined,
            // which would otherwise force consumers into `unavailable`.
            return undefined;
        }
        const key = remoteContentKey(status.remoteSha, status.movedFrom ?? status.path);
        let pending = this.pendingRemoteContent.get(key);
        if (!pending) {
            pending = this.readBlob(status.remoteSha, status.movedFrom ?? status.path).then(blob => blob.content);
            this.pendingRemoteContent.set(key, pending);
            // Fire-and-forget reap once the shared promise settles: the next
            // consumer after that starts a fresh read (this is in-flight
            // deduplication, not a long-lived content cache). The catch keeps
            // the reap chain from rejecting with nothing attached.
            void pending.catch(() => {}).then(() => this.pendingRemoteContent.delete(key));
        }
        const content = await pending;
        // Still write through to the status so the diff the user opened and
        // the stat both carry the fetched content forward (same contract as
        // the previous eager-write implementation).
        if (status.remoteContent === undefined) status.remoteContent = content;
        return content;
    }
}