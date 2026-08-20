import { describe, expect, it } from 'vitest';
import { SyncPlanner } from '../../../src/logic/sync/SyncPlanner';
import type { MoveFacts, SyncFacts, SyncClassification } from '../../../src/logic/sync/types';

const planner = new SyncPlanner();

function facts(localSha: string | undefined, remoteSha: string | undefined, baseSha?: string): SyncFacts {
    return {
        local: { path: 'note.md', exists: localSha !== undefined, blobSha: localSha, kind: 'text' },
        remote: { path: 'note.md', repoPath: 'note.md', exists: remoteSha !== undefined, blobSha: remoteSha, kind: 'text' },
        base: { blobSha: baseSha },
    };
}

describe('SyncPlanner', () => {
    it.each<[string, SyncFacts, SyncClassification]>([
        ['same local, remote, and base', facts('base', 'base', 'base'), 'synced'],
        ['local changed', facts('local', 'base', 'base'), 'local-modified'],
        ['remote changed', facts('base', 'remote', 'base'), 'remote-modified'],
        ['both changed differently', facts('local', 'remote', 'base'), 'conflict'],
        ['both changed identically', facts('next', 'next', 'base'), 'synced'],
        ['local only', facts('local', undefined), 'local-only'],
        ['remote only', facts(undefined, 'remote'), 'remote-only'],
        ['both absent', facts(undefined, undefined), 'synced'],
        ['untracked but equal', facts('same', 'same'), 'synced'],
        ['untracked and different', facts('local', 'remote'), 'conflict'],
    ])('%s', (_name, input, expected) => {
        expect(planner.classify(input)).toBe(expected);
    });

    it.each([
        ['local-modified', 'push-update'],
        ['local-only', 'push-create'],
        ['remote-modified', 'pull-overwrite'],
        ['remote-only', 'pull-create'],
        ['conflict', 'resolve-conflict'],
        ['synced', 'none'],
    ] as const)('maps %s to %s without IO', (classification, action) => {
        expect(planner.actionFor(classification)).toBe(action);
    });

    it('keeps binary and symlink kinds in the immutable plan', () => {
        const binary = facts('local', undefined);
        binary.local.kind = 'binary';
        const symlink = facts(undefined, 'remote');
        symlink.remote.kind = 'symlink';

        expect(planner.plan(binary)).toMatchObject({ classification: 'local-only', action: 'push-create', kind: 'binary' });
        expect(planner.plan(symlink)).toMatchObject({ classification: 'remote-only', action: 'pull-create', kind: 'symlink' });
    });

    it('plans an edited rename as one move regardless of an older content baseline', () => {
        const move: MoveFacts = {
            local: { path: 'new.md', exists: true, blobSha: 'local-edit', kind: 'text' },
            source: { path: 'old.md', repoPath: 'old.md', exists: true, blobSha: 'remote-source', kind: 'text' },
            destination: { path: 'new.md', repoPath: 'new.md', exists: false, kind: 'text' },
        };

        expect(planner.planMove(move)).toMatchObject({
            path: 'new.md',
            repoPath: 'new.md',
            classification: 'local-modified',
            action: 'move',
        });
    });

    it('resolves a move target collision as a conflict', () => {
        const move: MoveFacts = {
            local: { path: 'new.md', exists: true, blobSha: 'local', kind: 'text' },
            source: { path: 'old.md', repoPath: 'old.md', exists: true, blobSha: 'source', kind: 'text' },
            destination: { path: 'new.md', repoPath: 'new.md', exists: true, blobSha: 'target', kind: 'text' },
        };

        expect(planner.planMove(move)).toMatchObject({ classification: 'conflict', action: 'resolve-conflict' });
    });

    it.each([
        ['push', facts('local', 'base', 'base'), 'local-modified', 'push-update'],
        ['push', facts('base', 'remote', 'base'), 'remote-modified', 'resolve-conflict'],
        ['pull', facts('local', 'base', 'base'), 'local-modified', 'pull-overwrite'],
        ['pull', facts('base', 'remote', 'base'), 'remote-modified', 'pull-overwrite'],
        ['push', facts('local', 'remote'), 'local-modified', 'push-update'],
        ['pull', facts('local', 'remote'), 'remote-modified', 'pull-overwrite'],
        ['pull', facts('local', 'remote', 'base'), 'conflict', 'resolve-conflict'],
    ] as const)('plans %s operations through one decision matrix', (direction, input, classification, action) => {
        expect(planner.planFor(direction, input)).toMatchObject({ classification, action });
    });
});
