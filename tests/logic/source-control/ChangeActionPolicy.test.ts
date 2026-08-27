import { describe, expect, it } from 'vitest';
import { canDownload, defaultSyncAction } from '../../../src/logic/source-control/ChangeActionPolicy';
import type { SyncChangeKind } from '../../../src/logic/source-control/types';

describe('defaultSyncAction', () => {
    it('routes local-only to push', () => {
        expect(defaultSyncAction('local-only')).toBe('push');
    });

    it('routes local-modified to push', () => {
        expect(defaultSyncAction('local-modified')).toBe('push');
    });

    it('routes moved to push', () => {
        expect(defaultSyncAction('moved')).toBe('push');
    });

    it('routes conflict to push', () => {
        expect(defaultSyncAction('conflict')).toBe('push');
    });

    it('routes remote-only to pull', () => {
        expect(defaultSyncAction('remote-only')).toBe('pull');
    });

    it('routes remote-modified to pull', () => {
        expect(defaultSyncAction('remote-modified')).toBe('pull');
    });

    it('routes local-deleted to delete-remote, not pull, so Sync never silently restores a deliberate local delete', () => {
        expect(defaultSyncAction('local-deleted')).toBe('delete-remote');
    });

    it('covers every SyncChangeKind exhaustively', () => {
        const kinds: SyncChangeKind[] = [
            'local-only', 'local-modified', 'local-deleted',
            'remote-only', 'remote-modified', 'moved', 'conflict', 'synced',
        ];
        for (const kind of kinds) {
            expect(() => defaultSyncAction(kind)).not.toThrow();
            expect(defaultSyncAction(kind)).toBeTruthy();
        }
    });
});

describe('canDownload', () => {
    it('allows download for remote-only (never existed locally)', () => {
        expect(canDownload('remote-only')).toBe(true);
    });

    it('allows download for local-deleted (restore path back to the row)', () => {
        expect(canDownload('local-deleted')).toBe(true);
    });

    it('disallows download for kinds with no separate remote-restore action', () => {
        expect(canDownload('local-only')).toBe(false);
        expect(canDownload('local-modified')).toBe(false);
        expect(canDownload('remote-modified')).toBe(false);
        expect(canDownload('moved')).toBe(false);
        expect(canDownload('conflict')).toBe(false);
        expect(canDownload('synced')).toBe(false);
    });
});
