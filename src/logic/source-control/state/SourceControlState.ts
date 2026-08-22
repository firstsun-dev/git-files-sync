import type { ChangeRepository } from '../ChangeRepository';
import { ExpandedNodesState } from './ExpandedNodesState';
import { FilterState } from './FilterState';
import { OperationState } from './OperationState';
import { SelectedChangeState } from './SelectedChangeState';
import { SelectionState } from './SelectionState';

/**
 * The single Source Control UI state boundary: one container composing the
 * change model and every UI state slice (selection, operation, filter,
 * expanded nodes, selected change). The ViewModel reads from this and the
 * View mutates only through the ViewModel — nothing reaches the individual
 * slices directly from the UI.
 *
 * Intentionally a thin composition, not a god-object: each slice keeps its
 * own invariants and methods. The container exists so there is one thing to
 * construct/wire (in `main.ts` / `SourceControlItemView`) and one place the
 * "current UI state" is defined, instead of it being scattered across the
 * View's local fields and several unrelated stores.
 */
export class SourceControlState {
    constructor(
        readonly changes: ChangeRepository,
        readonly selection: SelectionState,
        readonly operations: OperationState,
        readonly filter: FilterState = new FilterState(),
        readonly expanded: ExpandedNodesState = new ExpandedNodesState(),
        readonly selectedChange: SelectedChangeState = new SelectedChangeState(),
    ) {}
}