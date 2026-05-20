import { describe, it, expect } from 'vitest';
import { computeSideBySideDiff } from '../../src/utils/diff';

describe('computeSideBySideDiff', () => {
    describe('identical content', () => {
        it('returns all unchanged rows for identical single-line content', () => {
            const rows = computeSideBySideDiff('hello', 'hello');
            expect(rows).toHaveLength(1);
            expect(rows[0]).toEqual({
                left:  { lineNum: 1, content: 'hello', type: 'unchanged' },
                right: { lineNum: 1, content: 'hello', type: 'unchanged' },
            });
        });

        it('returns all unchanged rows for identical multi-line content', () => {
            const text = 'line1\nline2\nline3';
            const rows = computeSideBySideDiff(text, text);
            expect(rows).toHaveLength(3);
            rows.forEach(row => {
                expect(row.left.type).toBe('unchanged');
                expect(row.right.type).toBe('unchanged');
            });
        });

        it('handles empty strings', () => {
            const rows = computeSideBySideDiff('', '');
            expect(rows).toHaveLength(1);
            expect(rows[0]!.left.type).toBe('unchanged');
        });
    });

    describe('CRLF normalisation', () => {
        it('treats CRLF and LF as identical', () => {
            const rows = computeSideBySideDiff('a\r\nb', 'a\nb');
            expect(rows).toHaveLength(2);
            rows.forEach(row => expect(row.left.type).toBe('unchanged'));
        });

        it('treats CR-only line endings as identical', () => {
            const rows = computeSideBySideDiff('a\rb', 'a\nb');
            expect(rows).toHaveLength(2);
            rows.forEach(row => expect(row.left.type).toBe('unchanged'));
        });
    });

    describe('additions only (remote → local adds lines)', () => {
        it('detects a single added line with empty phantom left side', () => {
            // 'a' is unchanged; 'b' is a pure add — no corresponding removed line → left side is empty
            const rows = computeSideBySideDiff('a', 'a\nb');
            const added = rows.find(r => r.right.type === 'added');
            expect(added).toBeDefined();
            expect(added!.right.content).toBe('b');
            expect(added!.left.type).toBe('empty');
            expect(added!.left.lineNum).toBeNull();
        });

        it('detects multiple added lines', () => {
            const rows = computeSideBySideDiff('a', 'a\nb\nc');
            const addedRows = rows.filter(r => r.right.type === 'added');
            expect(addedRows).toHaveLength(2);
            expect(addedRows.map(r => r.right.content)).toEqual(['b', 'c']);
        });

        it('treats single-line change as removed+added, not empty+added', () => {
            // Both sides have exactly one (different) line — no phantom empty side
            const rows = computeSideBySideDiff('old', 'new');
            expect(rows).toHaveLength(1);
            expect(rows[0]!.left.type).toBe('removed');
            expect(rows[0]!.right.type).toBe('added');
        });
    });

    describe('removals only (remote has extra lines vs local)', () => {
        it('detects a single removed line with empty phantom right side', () => {
            // 'a' is unchanged; 'b' is a pure remove — no corresponding added line → right side is empty
            const rows = computeSideBySideDiff('a\nb', 'a');
            const removed = rows.find(r => r.left.type === 'removed');
            expect(removed).toBeDefined();
            expect(removed!.left.content).toBe('b');
            expect(removed!.right.type).toBe('empty');
            expect(removed!.right.lineNum).toBeNull();
        });

        it('detects multiple removed lines', () => {
            const rows = computeSideBySideDiff('a\nb\nc', 'a');
            const removedRows = rows.filter(r => r.left.type === 'removed');
            expect(removedRows).toHaveLength(2);
            expect(removedRows.map(r => r.left.content)).toEqual(['b', 'c']);
        });
    });

    describe('mixed changes', () => {
        it('correctly pairs removed and added lines', () => {
            const rows = computeSideBySideDiff('old line', 'new line');
            expect(rows).toHaveLength(1);
            expect(rows[0]!.left.type).toBe('removed');
            expect(rows[0]!.left.content).toBe('old line');
            expect(rows[0]!.right.type).toBe('added');
            expect(rows[0]!.right.content).toBe('new line');
        });

        it('preserves unchanged lines between changes', () => {
            const remote = 'header\nold body\nfooter';
            const local  = 'header\nnew body\nfooter';
            const rows = computeSideBySideDiff(remote, local);

            const unchanged = rows.filter(r => r.left.type === 'unchanged');
            expect(unchanged).toHaveLength(2);
            expect(unchanged[0]!.left.content).toBe('header');
            expect(unchanged[1]!.left.content).toBe('footer');

            const changed = rows.find(r => r.left.type === 'removed');
            expect(changed!.left.content).toBe('old body');
            expect(changed!.right.content).toBe('new body');
        });
    });

    describe('line numbers', () => {
        it('assigns correct 1-based line numbers to unchanged rows', () => {
            const rows = computeSideBySideDiff('a\nb\nc', 'a\nb\nc');
            rows.forEach((row, i) => {
                expect(row.left.lineNum).toBe(i + 1);
                expect(row.right.lineNum).toBe(i + 1);
            });
        });

        it('assigns null line number to empty (phantom) sides', () => {
            // Pure add: 'a' unchanged, 'b' added with no counterpart on the left
            const rows = computeSideBySideDiff('a', 'a\nb');
            const emptyRow = rows.find(r => r.left.type === 'empty');
            expect(emptyRow).toBeDefined();
            expect(emptyRow!.left.lineNum).toBeNull();
            expect(emptyRow!.left.content).toBeNull();
        });
    });

    describe('large file fallback (simpleDiff)', () => {
        it('falls back to simpleDiff for files exceeding LCS threshold', () => {
            // Create inputs where m*n > 250_000 to trigger simpleDiff
            const longRemote = Array.from({ length: 600 }, (_, i) => `remote line ${i}`).join('\n');
            const longLocal  = Array.from({ length: 600 }, (_, i) => `local line ${i}`).join('\n');

            const rows = computeSideBySideDiff(longRemote, longLocal);
            expect(rows).toHaveLength(600);
            // simpleDiff compares line-by-line; all differ here
            rows.forEach(row => {
                expect(row.left.type).toBe('removed');
                expect(row.right.type).toBe('added');
            });
        });

        it('simpleDiff handles remote shorter than local', () => {
            const longRemote = Array.from({ length: 600 }, () => 'same').join('\n');
            const longLocal  = Array.from({ length: 700 }, () => 'same').join('\n');

            const rows = computeSideBySideDiff(longRemote, longLocal);
            expect(rows).toHaveLength(700);

            // First 600 rows: identical content → unchanged
            expect(rows[0]!.left.type).toBe('unchanged');
            // Last 100 rows: added on the right
            const extraRows = rows.slice(600);
            extraRows.forEach(row => {
                expect(row.left.type).toBe('empty');
                expect(row.right.type).toBe('added');
            });
        });

        it('simpleDiff handles local shorter than remote', () => {
            const longRemote = Array.from({ length: 700 }, () => 'same').join('\n');
            const longLocal  = Array.from({ length: 600 }, () => 'same').join('\n');

            const rows = computeSideBySideDiff(longRemote, longLocal);
            expect(rows).toHaveLength(700);

            const extraRows = rows.slice(600);
            extraRows.forEach(row => {
                expect(row.left.type).toBe('removed');
                expect(row.right.type).toBe('empty');
            });
        });
    });
});
