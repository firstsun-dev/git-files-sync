import type { SourceControlFilter } from '../SourceControlFilter';

/** A filter that maps to a collapsible section (every filter except 'all'). */
export type SectionFilter = Exclude<SourceControlFilter, 'all'>;

/**
 * Which sections and folders the user has collapsed. UI presentation state
 * kept out of the View so collapse state survives a status-driven re-render
 * rather than resetting to the default every time.
 */
export class ExpandedNodesState {
    private readonly collapsedSections = new Set<SectionFilter>();
    private readonly collapsedFolders = new Set<string>();

    isSectionCollapsed(section: SectionFilter): boolean {
        return this.collapsedSections.has(section);
    }

    toggleSection(section: SectionFilter): void {
        if (this.collapsedSections.has(section)) this.collapsedSections.delete(section);
        else this.collapsedSections.add(section);
    }

    isFolderCollapsed(path: string): boolean {
        return this.collapsedFolders.has(path);
    }

    toggleFolder(path: string): void {
        if (this.collapsedFolders.has(path)) this.collapsedFolders.delete(path);
        else this.collapsedFolders.add(path);
    }

    /** Snapshot of collapsed folder paths; consumers only read (`.has`) it during one render. */
    getCollapsedFolders(): Set<string> {
        return this.collapsedFolders;
    }
}