/**
 * Tracks which pending sync changes are "Ready to Push" — independent of the
 * underlying change/plan model and of any UI. Deliberately avoids VCS
 * stage/unstage terminology since this isn't a staging area.
 */
export class PushSelectionStore {
    private readonly selected = new Set<string>();

    includeForPush(path: string): void {
        this.selected.add(path);
    }

    excludeFromPush(path: string): void {
        this.selected.delete(path);
    }

    isIncluded(path: string): boolean {
        return this.selected.has(path);
    }

    getSelectedPaths(): string[] {
        return [...this.selected];
    }

    /** Drops selections for paths that are no longer present, keeping the rest. */
    refresh(currentPaths: readonly string[]): void {
        const present = new Set(currentPaths);
        for (const path of this.selected) {
            if (!present.has(path)) {
                this.selected.delete(path);
            }
        }
    }
}
