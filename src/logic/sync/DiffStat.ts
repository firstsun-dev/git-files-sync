import { computeSideBySideDiff } from '../../utils/diff';

/** Additions/deletions for a single change's diff, the +/- stat a row shows. */
export interface ChangeStat {
    additions: number;
    deletions: number;
}

/**
 * What a diff-stat load resolved to for one row. The distinction matters
 * because a cache treats the three outcomes differently:
 * - `ready` — cached as a usable stat.
 * - `unavailable` — permanent (binary, symlink, no two sides to diff);
 *   cached so the row is never retried.
 * - `pending` — the backing content simply isn't in memory yet (e.g. a
 *   `local-only` row whose `localContent` hasn't been read). NOT cached:
 *   the next load pass retries the row, so a late-arriving stat still lands.
 */
export type DiffStatLoadResult =
    | { status: 'ready'; stat: ChangeStat }
    | { status: 'pending' }
    | { status: 'unavailable' };

/**
 * +/- stat for a two-sided diff (local-modified / remote-only /
 * remote-modified / moved / conflict), reusing the existing LCS op logic in
 * `utils/diff.ts`. Additions = added ops, deletions = removed ops.
 */
export function computeDiffStat(remote: string, local: string): ChangeStat {
    const rows = computeSideBySideDiff(remote, local);
    let additions = 0;
    let deletions = 0;
    for (const row of rows) {
        if (row.right.type === 'added') additions++;
        if (row.left.type === 'removed') deletions++;
    }
    return { additions, deletions };
}

/**
 * Cheap stat for a `local-only` change: additions only (the local line
 * count), no deletions and no remote/provider call. A trailing newline
 * doesn't add a phantom line.
 */
export function cheapLocalStat(local: string): ChangeStat {
    return { additions: countLines(local), deletions: 0 };
}

/**
 * Stat for a one-sided change whose only content is the ADDED side: every
 * line is an addition, no deletions. Used for `local-only` (A) and
 * `remote-only` (↓) — both show +N, not the -N a content-vs-'' diff would
 * produce for the download direction.
 */
export function addedContentStat(content: string): ChangeStat {
    return { additions: countLines(content), deletions: 0 };
}

/**
 * Stat for a one-sided DELETION: the content existed remotely and is gone
 * locally, so every line is a deletion. Used for `local-deleted` (D).
 */
export function deletedContentStat(content: string): ChangeStat {
    return { additions: 0, deletions: countLines(content) };
}

function countLines(s: string): number {
    if (s === '') return 0;
    const lines = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}
