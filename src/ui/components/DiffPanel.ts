import { computeSideBySideDiff, type DiffSide } from '../../utils/diff';

export function renderDiffPanel(fileEl: HTMLElement, remoteContent: string, localContent: string): HTMLElement {
    const diffEl = fileEl.createDiv({ cls: 'ssv-diff' });
    const rows = computeSideBySideDiff(remoteContent, localContent);

    const grid = diffEl.createDiv({ cls: 'ssv-diff-split' }).createDiv({ cls: 'ssv-diff-grid' });
    grid.createDiv({ cls: 'ssv-diff-hd', text: 'Remote' });
    grid.createDiv({ cls: 'ssv-diff-hd', text: 'Local' });
    for (const row of rows) {
        renderDiffCell(grid, row.left);
        renderDiffCell(grid, row.right);
    }

    const unifiedEl = diffEl.createEl('pre', { cls: 'ssv-diff-unified' });
    for (const { left, right } of rows) {
        if (left.type === 'removed')   unifiedEl.createSpan({ cls: 'ssv-u-line removed'   }).textContent = `- ${left.content ?? ''}\n`;
        if (right.type === 'added')    unifiedEl.createSpan({ cls: 'ssv-u-line added'     }).textContent = `+ ${right.content ?? ''}\n`;
        if (left.type === 'unchanged') unifiedEl.createSpan({ cls: 'ssv-u-line unchanged' }).textContent = `  ${left.content ?? ''}\n`;
    }

    return diffEl;
}

function renderDiffCell(grid: HTMLElement, side: DiffSide): void {
    const cell = grid.createDiv({ cls: `ssv-diff-cell ${side.type}` });
    cell.createSpan({ cls: 'ssv-diff-ln' }).textContent = side.lineNum === null ? '' : String(side.lineNum);
    if (side.content !== null) {
        cell.createSpan({ cls: 'ssv-diff-code' }).textContent = side.content;
    }
}
