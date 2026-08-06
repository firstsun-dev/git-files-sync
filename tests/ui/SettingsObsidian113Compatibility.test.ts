import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS, GitLabSyncSettingTab } from '../../src/settings';
import GitLabFilesPush, { type ConnectionStatus } from '../../src/main';
import { createContainer, setupObsidianDOM } from './setup-dom';

vi.mock('../../src/main', () => ({
  default: class {},
}));

beforeAll(() => { setupObsidianDOM(); });

function createPluginStub(): GitLabFilesPush {
  return {
    settings: { ...DEFAULT_SETTINGS },
    manifest: { version: '0.0.0-test' },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    initializeGitService: vi.fn(),
    onConnectionStatusChange: vi.fn((listener: (status: ConnectionStatus) => void) => {
      listener({ state: 'checking' });
      return vi.fn();
    }),
    testConnection: vi.fn().mockResolvedValue({ repoOk: false, branchOk: false }),
  } as unknown as GitLabFilesPush;
}

/**
 * Mirrors Obsidian 1.13's compatibility behavior: a non-empty declarative
 * definition list suppresses display(); otherwise the legacy imperative tab
 * is rendered. Issue #98 was caused by the plugin returning one declarative
 * definition that emptied the SettingGroup container while it was rendering.
 */
function renderAsObsidian113(tab: GitLabSyncSettingTab): void {
  const definitions = tab.getSettingDefinitions();

  if (definitions.length === 0) {
    tab.display();
  }
}

describe('GitLabSyncSettingTab on Obsidian 1.13+', () => {
  it('returns no declarative definitions until the tab is fully migrated', () => {
    const tab = new GitLabSyncSettingTab(new App(), createPluginStub());

    expect(tab.getSettingDefinitions()).toEqual([]);
  });

  it('falls back to display() and renders settings instead of a blank page', () => {
    vi.useFakeTimers();
    const tab = new GitLabSyncSettingTab(new App(), createPluginStub());
    tab.containerEl = createContainer();
    const displaySpy = vi.spyOn(tab, 'display');

    try {
      renderAsObsidian113(tab);

      expect(displaySpy).toHaveBeenCalledOnce();
      expect(tab.containerEl.childElementCount).toBeGreaterThan(0);
      expect(tab.containerEl.querySelector('input')).not.toBeNull();
      expect(tab.containerEl.querySelector('button')).not.toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
