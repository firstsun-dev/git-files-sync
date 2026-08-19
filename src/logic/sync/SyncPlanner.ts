import type {
    ContentKind,
    PlannedFileAction,
    SyncAction,
    SyncClassification,
    SyncFacts,
} from './types';

/** Pure comparison of local, remote, and last-synced snapshots. */
export class SyncPlanner {
    classify(facts: SyncFacts): SyncClassification {
        const { local, remote, base } = facts;
        if (!local.exists && !remote.exists) return 'synced';
        if (local.exists && !remote.exists) return 'local-only';
        if (!local.exists && remote.exists) return 'remote-only';
        if (local.blobSha === remote.blobSha) return 'synced';
        if (!base.blobSha) return 'conflict';

        const localChanged = local.blobSha !== base.blobSha;
        const remoteChanged = remote.blobSha !== base.blobSha;
        if (localChanged && remoteChanged) return 'conflict';
        if (localChanged) return 'local-modified';
        if (remoteChanged) return 'remote-modified';
        return 'synced';
    }

    actionFor(classification: SyncClassification): SyncAction {
        switch (classification) {
            case 'local-only': return 'push-create';
            case 'local-modified': return 'push-update';
            case 'remote-only': return 'pull-create';
            case 'remote-modified': return 'pull-overwrite';
            case 'conflict': return 'resolve-conflict';
            case 'synced': return 'none';
        }
    }

    plan(facts: SyncFacts): PlannedFileAction {
        const classification = this.classify(facts);
        return {
            path: facts.local.path || facts.remote.path,
            repoPath: facts.remote.repoPath,
            kind: this.contentKind(facts),
            classification,
            action: this.actionFor(classification),
        };
    }

    private contentKind(facts: SyncFacts): ContentKind {
        return facts.local.exists ? facts.local.kind : facts.remote.kind;
    }
}
