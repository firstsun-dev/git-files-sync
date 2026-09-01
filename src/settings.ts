// Public compatibility surface: re-exports the settings model/helpers and the
// settings UI so existing `from './settings'` / `from '../settings'` imports
// across the codebase keep working unchanged. See src/settings/ (model,
// helpers) and src/ui/settings/GitLabSyncSettingTab.ts for the actual
// implementations; nothing else should be added directly to this file.
export * from './settings/model';
export * from './settings/helpers';
export type { SettingsHost } from './ui/settings/GitLabSyncSettingTab';

import {
	GitLabSyncSettingTab as ImperativeGitLabSyncSettingTab,
} from './ui/settings/GitLabSyncSettingTab';

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
