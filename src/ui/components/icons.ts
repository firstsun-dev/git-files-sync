// Single source of truth for every icon used in the Sync Status view.
//
// Values are Lucide icon ids rendered through Obsidian's `setIcon`, so all
// icons share one visual style (stroke weight, size, baseline) and stay
// consistent across desktop and mobile. Reuse these constants everywhere a
// status or action icon is shown instead of inlining Unicode glyphs.
export const ICONS = {
    // Status / action
    synced:   'check',
    modified: 'pencil',
    push:     'arrow-up',
    pull:     'arrow-down',
    checking: 'refresh-cw',
    refresh:  'refresh-cw',
    delete:   'trash-2',
    diff:     'file-diff',
    diffOpen: 'chevron-up',
    // Search filter
    search:   'search',
    clear:    'x',
    // Info strip
    branch:   'git-branch',
    folder:   'folder',
} as const;
