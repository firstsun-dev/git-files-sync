import { setIcon } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import { ICONS } from '../components/icons';
import type { OperationStatus } from '../../logic/source-control/OperationState';

const OP_LABEL_KEYS: Record<Exclude<OperationStatus, 'idle'>, TranslationKey> = {
    running: 'sourceControl.op.syncing',
    success: 'sourceControl.op.synced',
    failed: 'sourceControl.op.failed',
};

/**
 * Renders a small per-change status indicator for an in-flight operation:
 * icon plus a short text label ("Syncing" / "Synced" / "Failed"). Renders
 * nothing for 'idle' — the common case — so rows stay quiet until an
 * operation is actually running/finished.
 */
export function renderOperationIndicator(container: HTMLElement, status: OperationStatus): HTMLElement | undefined {
    if (status === 'idle') return undefined;

    const el = container.createSpan({ cls: `scv-op-indicator scv-op-${status}` });
    setIcon(el.createSpan({ cls: 'scv-op-icon' }), operationIcon(status));
    el.createSpan({ cls: 'scv-op-label', text: t(OP_LABEL_KEYS[status]) });
    return el;
}

function operationIcon(status: Exclude<OperationStatus, 'idle'>): string {
    if (status === 'running') return ICONS.checking;
    if (status === 'success') return ICONS.synced;
    return ICONS.error;
}
