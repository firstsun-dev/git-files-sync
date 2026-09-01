import { describe, expect, it } from 'vitest';
import {
    availableSyncActions,
    canDownload,
    defaultSyncAction,
    resolveSyncAction,
} from '../../../src/logic/source-control/ChangeActionPolicy';
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

    it('allows download for remote-modified (overwrite the local copy)', () => {
        expect(canDownload('remote-modified')).toBe(true);
    });

    it('disallows download for kinds with no separate remote-restore action', () => {
        expect(canDownload('local-only')).toBe(false);
        expect(canDownload('local-modified')).toBe(false);
        expect(canDownload('moved')).toBe(false);
        expect(canDownload('conflict')).toBe(false);
        expect(canDownload('synced')).toBe(false);
    });
});

describe('availableSyncActions', () => {
    it('lists the default first', () => {
        expect(availableSyncActions('local-modified')[0]).toBe(defaultSyncAction('local-modified'));
        expect(availableSyncActions('remote-only')[0]).toBe(defaultSyncAction('remote-only'));
        expect(availableSyncActions('local-deleted')[0]).toBe(defaultSyncAction('local-deleted'));
    });

    it('allows push and pull for local-modified (push local, or use remote instead)', () => {
        expect(availableSyncActions('local-modified')).toEqual(['push', 'pull']);
    });

    it('allows pull and delete-remote for remote-only (download, or delete it remotely)', () => {
        expect(availableSyncActions('remote-only')).toEqual(['pull', 'delete-remote']);
    });

    it('allows pull and push for remote-modified (use remote, or overwrite with local)', () => {
        expect(availableSyncActions('remote-modified')).toEqual(['pull', 'push']);
    });

    it('allows delete-remote and pull for local-deleted (mirror the delete, or restore it)', () => {
        expect(availableSyncActions('local-deleted')).toEqual(['delete-remote', 'pull']);
    });

    it('only allows the default for local-only, moved, conflict, and synced', () => {
        expect(availableSyncActions('local-only')).toEqual(['push']);
        expect(availableSyncActions('moved')).toEqual(['push']);
        expect(availableSyncActions('conflict')).toEqual(['push']);
        expect(availableSyncActions('synced')).toEqual(['push']);
    });
});

describe('resolveSyncAction', () => {
    it('returns the default when no override is given', () => {
        expect(resolveSyncAction('local-modified')).toBe('push');
        expect(resolveSyncAction('remote-only')).toBe('pull');
    });

    it('honors a legal override', () => {
        expect(resolveSyncAction('local-modified', 'pull')).toBe('pull');
        expect(resolveSyncAction('remote-only', 'delete-remote')).toBe('delete-remote');
    });

    it('falls back to the default when the override is no longer legal for the kind', () => {
        // e.g. stored override was 'pull' while the change was local-modified,
        // then it became local-only (remote copy deleted) — 'pull' can't apply anymore.
        expect(resolveSyncAction('local-only', 'pull')).toBe('push');
    });

    it('falls back to the default for kinds that only allow their default', () => {
        expect(resolveSyncAction('conflict', 'pull')).toBe('push');
        expect(resolveSyncAction('moved', 'pull')).toBe('push');
    });
});
