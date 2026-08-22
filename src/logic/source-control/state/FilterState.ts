import type { SourceControlFilter } from '../SourceControlFilter';

/**
 * The currently active Source Control filter. A single-value UI state slice
 * kept out of the View so the ViewModel/state is the single source of truth
 * for what the UI is showing (no parallel local copy that can drift).
 */
export class FilterState {
    private filter: SourceControlFilter = 'all';

    get(): SourceControlFilter {
        return this.filter;
    }

    set(filter: SourceControlFilter): void {
        this.filter = filter;
    }
}