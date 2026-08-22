import { describe, expect, it } from 'vitest';
import { ExpandedNodesState } from '../../../../src/logic/source-control/state/ExpandedNodesState';

describe('ExpandedNodesState', () => {
    describe('sections', () => {
        it('sections are expanded by default', () => {
            const state = new ExpandedNodesState();
            expect(state.isSectionCollapsed('changes')).toBe(false);
        });

        it('toggles a section collapsed and back', () => {
            const state = new ExpandedNodesState();
            state.toggleSection('conflicts');
            expect(state.isSectionCollapsed('conflicts')).toBe(true);

            state.toggleSection('conflicts');
            expect(state.isSectionCollapsed('conflicts')).toBe(false);
        });

        it('tracks sections independently', () => {
            const state = new ExpandedNodesState();
            state.toggleSection('changes');
            state.toggleSection('conflicts');

            expect(state.isSectionCollapsed('changes')).toBe(true);
            expect(state.isSectionCollapsed('conflicts')).toBe(true);
            expect(state.isSectionCollapsed('synced')).toBe(false);
        });
    });

    describe('folders', () => {
        it('folders are expanded by default', () => {
            const state = new ExpandedNodesState();
            expect(state.isFolderCollapsed('blog')).toBe(false);
        });

        it('toggles a folder collapsed and exposes the collapsed set', () => {
            const state = new ExpandedNodesState();
            state.toggleFolder('blog/posts');
            state.toggleFolder('notes');

            expect(state.isFolderCollapsed('blog/posts')).toBe(true);
            expect(state.isFolderCollapsed('notes')).toBe(true);
            expect(state.getCollapsedFolders()).toEqual(new Set(['blog/posts', 'notes']));
        });
    });
});