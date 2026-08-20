export type { FileStatus } from '../logic/sync-status-service';
export type { SyncPlan, SyncPlanEntry } from '../logic/sync/types';
export { isSyncPlanEmpty } from '../logic/sync/types';

export type FilterValue = 'all' | 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'moved';
