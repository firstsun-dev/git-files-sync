import type {
    ContentKind,
    MoveFacts,
    PlannedFileAction,
    SyncAction,
    SyncClassification,
    SyncFacts,
    SyncOperation,
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

    planFor(operation: SyncOperation, facts: SyncFacts): PlannedFileAction {
        const classification = this.classifyForOperation(operation, facts);
        return {
            path: facts.local.path || facts.remote.path,
            repoPath: facts.remote.repoPath,
            kind: this.contentKind(facts),
            classification,
            action: this.actionForOperation(operation, classification),
        };
    }

    planMove(facts: MoveFacts): PlannedFileAction {
        const destinationOccupied = facts.destination.exists;
        const contentClassification: SyncClassification = facts.local.blobSha === facts.source.blobSha
            ? 'synced'
            : 'local-modified';
        const classification: SyncClassification = destinationOccupied ? 'conflict' : contentClassification;
        return {
            path: facts.local.path,
            repoPath: facts.destination.repoPath,
            kind: facts.local.kind,
            classification,
            action: destinationOccupied ? 'resolve-conflict' : 'move',
        };
    }

    private contentKind(facts: SyncFacts): ContentKind {
        return facts.local.exists ? facts.local.kind : facts.remote.kind;
    }

    private classifyForOperation(operation: SyncOperation, facts: SyncFacts): SyncClassification {
        const classification = this.classify(facts);
        if (classification !== 'conflict' || facts.base.blobSha) return classification;
        return operation === 'push' ? 'local-modified' : 'remote-modified';
    }

    private actionForOperation(operation: SyncOperation, classification: SyncClassification): SyncAction {
        if (classification === 'synced') return 'none';
        if (classification === 'conflict') return 'resolve-conflict';
        if (operation === 'push') {
            if (classification === 'local-only') return 'push-create';
            if (classification === 'local-modified') return 'push-update';
            return 'resolve-conflict';
        }
        if (classification === 'remote-only') return 'pull-create';
        if (classification === 'local-only') return 'none';
        return 'pull-overwrite';
    }
}
