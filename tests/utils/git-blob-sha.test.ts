import { describe, it, expect } from 'vitest';
import { gitBlobSha } from '../../src/utils/git-blob-sha';

// Test vectors verified against `git hash-object --stdin`.
describe('gitBlobSha', () => {
    it('matches git for empty content', async () => {
        expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    });

    it('matches git for a string with no trailing newline', async () => {
        expect(await gitBlobSha('hello world')).toBe('95d09f2b10159347eece71399a7e2e907ea3df4f');
    });

    it('matches git for a string with a trailing newline', async () => {
        expect(await gitBlobSha('hello world\n')).toBe('3b18e512dba79e4c8300dd08aeb37f8e728b8dad');
    });

    it('matches git for multi-byte UTF-8 content', async () => {
        // "café" is 5 bytes in UTF-8 (é is 2 bytes) — verifies byte length, not char length, is used.
        expect(await gitBlobSha('café')).toBe('1c2e52cfe7542a64cdea57e5fec2fc1739846c03');
    });

    it('produces the same SHA for equivalent string and ArrayBuffer content', async () => {
        const text = 'hello world';
        const bytes = new TextEncoder().encode(text);
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

        expect(await gitBlobSha(arrayBuffer)).toBe(await gitBlobSha(text));
    });

    it('produces different SHAs for different content', async () => {
        expect(await gitBlobSha('a')).not.toBe(await gitBlobSha('b'));
    });
});
