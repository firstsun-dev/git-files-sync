import type { SyncAction } from './ChangeActionPolicy';
import type { ChangeId } from './types';

/**
 * One queued Source Control intent. `action` is present only when the user
 * explicitly chose a legal non-default action for the change at the time the
 * queue snapshot was built. Execution always re-validates it against the
 * repository's current change kind before doing any work.
 */
export interface SyncIntentRequest {
    changeId: ChangeId;
    action?: SyncAction;
}
