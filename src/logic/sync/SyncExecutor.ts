import type { ConflictResolver } from './ConflictResolver';
import type { PullExecutor } from './PullExecutor';
import type { PushExecutor } from './PushExecutor';

/** Mutation facade shared by SyncManager orchestration. */
export class SyncExecutor {
    constructor(
        readonly push: PushExecutor,
        readonly pull: PullExecutor,
        readonly conflicts: ConflictResolver,
    ) {}
}
