export * from './settings-implementation';

import {
	GitLabSyncSettingTab as ImperativeGitLabSyncSettingTab,
} from './settings-implementation';

/**
 * Keep the existing imperative settings UI on Obsidian's display() lifecycle.
 *
 * Obsidian 1.13+ skips display() when getSettingDefinitions() returns a
 * non-empty list. The previous compatibility adapter returned one custom
 * definition and then cleared the SettingGroup container from inside its
 * render callback, which produced the blank settings page reported in #98.
 * Returning an empty list explicitly opts out until the tab is fully migrated
 * to declarative settings.
 */
export class GitLabSyncSettingTab extends ImperativeGitLabSyncSettingTab {
	override getSettingDefinitions(): [] {
		return [];
	}
}
