import { setIcon } from 'obsidian';
import { ICONS } from '../components/icons';
import type { OperationStatus } from '../../logic/source-control/OperationState';

/**
 * Renders a small per-change status indicator for an in-flight operation.
 * Renders nothing for 'idle' — the common case — so rows stay quiet until an
 * operation is actually running/finished.
 */
export function renderOperationIndicator(container: HTMLElement, status: OperationStatus): HTMLElement | undefined {
    if (status === 'idle') return undefined;

    const el = container.createSpan({ cls: `scv-op-indicator scv-op-${status}` });
    setIcon(el, operationIcon(status));
    return el;
}

function operationIcon(status: Exclude<OperationStatus, 'idle'>): string {
    if (status === 'running') return ICONS.checking;
    if (status === 'success') return ICONS.synced;
    return ICONS.error;
}
