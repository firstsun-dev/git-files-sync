import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitVerifier } from '../support/git-verifier';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(directory: string, args: string[]): void {
    execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' });
}

function createVerifierRepository(): string {
    const directory = mkdtempSync(join(tmpdir(), 'git-verifier-'));
    temporaryDirectories.push(directory);
    const remote = join(directory, 'remote.git');
    const writer = join(directory, 'writer');
    const verifierClone = join(directory, 'verifier');
    execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
    execFileSync('git', ['clone', remote, writer], { stdio: 'pipe' });
    git(writer, ['config', 'user.name', 'E2E Test']);
    git(writer, ['config', 'user.email', 'e2e@example.invalid']);
    git(writer, ['checkout', '-b', 'main']);
    writeFileSync(join(writer, 'note.md'), 'snapshot content');
    git(writer, ['add', 'note.md']);
    git(writer, ['commit', '-m', 'seed snapshot']);
    git(writer, ['push', '-u', 'origin', 'main']);
    execFileSync('git', ['clone', remote, verifierClone], { stdio: 'pipe' });
    return verifierClone;
}

describe('GitVerifier snapshots', () => {
    it('fetches once and serves all remote assertions from the captured branch state', async () => {
        const verifier = new GitVerifier(createVerifierRepository());
        const fetch = vi.spyOn(verifier as unknown as { fetch(ref: string): void }, 'fetch');

        const snapshot = await verifier.snapshot('main');

        expect(snapshot.getFile('note.md')?.content).toBe('snapshot content');
        expect(snapshot.fileMissing('missing.md')).toBe(true);
        expect(snapshot.listFiles()).toEqual(['note.md']);
        expect(snapshot.listCommitShas(1)).toHaveLength(1);
        expect(snapshot.getBlobMode('note.md')).toBe('100644');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
