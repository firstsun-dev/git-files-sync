export interface DiffSide {
    lineNum: number | null;
    content: string | null;
    type: 'removed' | 'added' | 'unchanged' | 'empty';
}

export interface DiffRow {
    left: DiffSide;
    right: DiffSide;
}

type DiffOpType = 'unchanged' | 'removed' | 'added';

interface DiffOp {
    type: DiffOpType;
    li: number;
    ri: number;
}

export function computeSideBySideDiff(remote: string, local: string): DiffRow[] {
    const L = normalizeContent(remote).split('\n');
    const R = normalizeContent(local).split('\n');
    const m = L.length, n = R.length;

    if (m * n > 250_000 || (m + 1) * (n + 1) > 1_000_000) {
        return simpleDiff(L, R);
    }

    const dp = buildDPMatrix(L, R, m, n);
    const ops = tracePath(L, R, dp, m, n);
    return pairDiffOps(ops, L, R);
}

function normalizeContent(s: string): string {
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function buildDPMatrix(L: string[], R: string[], m: number, n: number): Uint32Array {
    const W = n + 1;
    const dp = new Uint32Array((m + 1) * W);
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i * W + j] = L[i - 1] === R[j - 1]
                ? (dp[(i - 1) * W + (j - 1)]!) + 1
                : Math.max(dp[(i - 1) * W + j]!, dp[i * W + (j - 1)]!);
        }
    }
    return dp;
}

function tracePath(L: string[], R: string[], dp: Uint32Array, m: number, n: number): DiffOp[] {
    const W = n + 1;
    const ops: DiffOp[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        const op = getNextDiffOp(L, R, dp, W, i, j);
        ops.push(op);
        [i, j] = updateIndices(op, i, j);
    }
    return ops.reverse();
}

function updateIndices(op: DiffOp, i: number, j: number): [number, number] {
    if (op.type === 'unchanged') return [i - 1, j - 1];
    if (op.type === 'added') return [i, j - 1];
    return [i - 1, j];
}

function getNextDiffOp(L: string[], R: string[], dp: Uint32Array, W: number, i: number, j: number): DiffOp {
    if (i > 0 && j > 0 && L[i - 1] === R[j - 1]) {
        return { type: 'unchanged', li: i - 1, ri: j - 1 };
    }

    const canAdd = j > 0;
    const preferAdd = canAdd && (i === 0 || dp[i * W + (j - 1)]! >= dp[(i - 1) * W + j]!);

    if (preferAdd) {
        return { type: 'added', li: -1, ri: j - 1 };
    }
    return { type: 'removed', li: i - 1, ri: -1 };
}

function pairDiffOps(ops: DiffOp[], L: string[], R: string[]): DiffRow[] {
    const rows: DiffRow[] = [];
    let k = 0;
    while (k < ops.length) {
        const op = ops[k];
        if (!op) break;

        if (op.type === 'unchanged') {
            rows.push(createUnchangedRow(op, L, R));
            k++;
        } else {
            const batch = collectChangeBatch(ops, k);
            rows.push(...createChangeRows(batch, L, R));
            k += batch.length;
        }
    }
    return rows;
}

function createUnchangedRow(op: DiffOp, L: string[], R: string[]): DiffRow {
    return {
        left:  { lineNum: op.li + 1, content: L[op.li] ?? null, type: 'unchanged' },
        right: { lineNum: op.ri + 1, content: R[op.ri] ?? null, type: 'unchanged' },
    };
}

function collectChangeBatch(ops: DiffOp[], startIdx: number): DiffOp[] {
    const batch: DiffOp[] = [];
    let k = startIdx;
    while (k < ops.length) {
        const item = ops[k];
        if (!item || item.type === 'unchanged') break;
        batch.push(item);
        k++;
    }
    return batch;
}

function createChangeRows(batch: DiffOp[], L: string[], R: string[]): DiffRow[] {
    const removedIdxs = batch.filter(o => o.type === 'removed').map(o => o.li);
    const addedIdxs = batch.filter(o => o.type === 'added').map(o => o.ri);
    const len = Math.max(removedIdxs.length, addedIdxs.length);
    const rows: DiffRow[] = [];

    for (let x = 0; x < len; x++) {
        rows.push({
            left: createDiffSide(removedIdxs[x], L, 'removed'),
            right: createDiffSide(addedIdxs[x], R, 'added')
        });
    }
    return rows;
}

function createDiffSide(idx: number | undefined, lines: string[], type: 'removed' | 'added'): DiffSide {
    if (idx === undefined) {
        return { lineNum: null, content: null, type: 'empty' };
    }
    return { lineNum: idx + 1, content: lines[idx] ?? null, type };
}

function simpleDiff(L: string[], R: string[]): DiffRow[] {
    const rows: DiffRow[] = [];
    const max = Math.max(L.length, R.length);
    for (let i = 0; i < max; i++) {
        const l = L[i], r = R[i];
        if (l === undefined)      rows.push({ left: { lineNum: null,  content: null, type: 'empty'     }, right: { lineNum: i + 1, content: r ?? null, type: 'added'     } });
        else if (r === undefined) rows.push({ left: { lineNum: i + 1, content: l,    type: 'removed'   }, right: { lineNum: null,  content: null,      type: 'empty'     } });
        else if (l === r)         rows.push({ left: { lineNum: i + 1, content: l,    type: 'unchanged' }, right: { lineNum: i + 1, content: r,         type: 'unchanged' } });
        else                      rows.push({ left: { lineNum: i + 1, content: l,    type: 'removed'   }, right: { lineNum: i + 1, content: r,         type: 'added'     } });
    }
    return rows;
}
