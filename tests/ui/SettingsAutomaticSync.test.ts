import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS, GitLabSyncSettingTab } from '../../src/settings';
import GitLabFilesPush, { type ConnectionStatus } from '../../src/main';
import type { ConnectionTestResult } from '../../src/services/git-service-interface';
import { createContainer, setupObsidianDOM } from './setup-dom';

vi.mock('../../src/main', () => ({
  default: class {},
}));

beforeAll(() => { setupObsidianDOM(); });

interface PluginStub {
  plugin: GitLabFilesPush;
  saveSettings: ReturnType<typeof vi.fn>;
}

function createPluginStub(): PluginStub {
  const saveSettings = vi.fn().mockResolvedValue(undefined);
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    manifest: { version: '0.0.0-test' },
    saveSettings,
    initializeGitService: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ repoOk: true, branchOk: true } satisfies ConnectionTestResult),
    onConnectionStatusChange: vi.fn((listener: (status: ConnectionStatus) => void) => {
      listener({ state: 'checking' });
      return () => undefined;
    }),
  } as unknown as GitLabFilesPush;
  return { plugin, saveSettings };
}

function renderTab(overrides: Partial<GitLabFilesPush['settings']> = {}): {
  tab: GitLabSyncSettingTab;
  plugin: GitLabFilesPush;
  saveSettings: ReturnType<typeof vi.fn>;
} {
  vi.useFakeTimers();
  const { plugin, saveSettings } = createPluginStub();
  plugin.settings = { ...plugin.settings, ...overrides };
  const tab = new GitLabSyncSettingTab(new App(), plugin, plugin);
  tab.containerEl = createContainer();
  tab.display();
  return { tab, plugin, saveSettings };
}

/** Finds the toggle input whose surrounding Setting row has the given name. */
function toggleByName(tab: GitLabSyncSettingTab, name: string): HTMLInputElement | null {
  const inputs = Array.from(tab.containerEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  for (const input of inputs) {
    const row = input.closest('.setting-item');
    if (row?.textContent?.includes(name)) return input;
  }
  return null;
}

/** The Automatic sync interval text input (placeholder mirrors the 5-minute default). */
function intervalInputByName(tab: GitLabSyncSettingTab): HTMLInputElement | undefined {
  return Array.from(tab.containerEl.querySelectorAll<HTMLInputElement>('input[type="text"]'))
    .find(input => input.placeholder === '5');
}

/** Flips a checkbox the way a user click would (JSDOM click() misses change events). */
function flipToggle(input: HTMLInputElement): void {
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change'));
}

describe('GitLabSyncSettingTab automatic sync', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('defaults automatic sync OFF, interval 5 minutes, and startup sync OFF', () => {
    const { plugin } = renderTab();
    expect(plugin.settings.automaticSyncEnabled).toBe(false);
    expect(plugin.settings.automaticSyncIntervalMinutes).toBe(5);
    expect(plugin.settings.automaticSyncOnStartup).toBe(false);
  });

  it('renders the Automatic sync, Sync interval, and Sync on startup rows plus the separate refresh row', () => {
    const { tab } = renderTab();

    const text = tab.containerEl.textContent ?? '';
    // These strings come from en.ts (default locale in tests).
    expect(text).toContain('Automatic sync');
    expect(text).toContain('Sync interval (minutes)');
    expect(text).toContain('Sync on startup');
    // The existing refresh setting stays a distinct, separately-labeled control.
    expect(text).toContain('Refresh status on startup');
  });

  it('persists an enabled automatic sync toggle through saveSettings', () => {
    const { tab, plugin, saveSettings } = renderTab();
    const toggle = toggleByName(tab, 'Automatic sync');
    expect(toggle).not.toBeNull();

    flipToggle(toggle!);

    expect(plugin.settings.automaticSyncEnabled).toBe(true);
    expect(saveSettings).toHaveBeenCalled();
  });

  it('seeds the interval control with the saved value and sanitizes invalid input to the default', () => {
    const { tab, plugin } = renderTab({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 15 });
    const intervalInput = intervalInputByName(tab);
    expect(intervalInput?.value).toBe('15');

    intervalInput!.value = '0';
    intervalInput!.dispatchEvent(new Event('input'));
    expect(plugin.settings.automaticSyncIntervalMinutes).toBe(5);
  });

  it('clamps the interval to the minimum of 1 minute', () => {
    const { tab, plugin } = renderTab({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 5 });
    const intervalInput = intervalInputByName(tab);

    intervalInput!.value = '1';
    intervalInput!.dispatchEvent(new Event('input'));
    expect(plugin.settings.automaticSyncIntervalMinutes).toBe(1);
  });

  it('persists the Sync on startup toggle', () => {
    const { tab, plugin, saveSettings } = renderTab({ automaticSyncEnabled: true });
    const toggle = toggleByName(tab, 'Sync on startup');
    expect(toggle).not.toBeNull();

    flipToggle(toggle!);

    expect(plugin.settings.automaticSyncOnStartup).toBe(true);
    expect(saveSettings).toHaveBeenCalled();
  });

  it('does not change the existing refresh status on startup semantics', () => {
    const { tab, plugin } = renderTab({ autoRefreshOnStartup: true });
    const toggle = toggleByName(tab, 'Refresh status on startup');
    expect(toggle).not.toBeNull();

    flipToggle(toggle!);

    expect(plugin.settings.autoRefreshOnStartup).toBe(false);
    // The automatic-sync fields remain untouched by this control.
    expect(plugin.settings.automaticSyncEnabled).toBe(false);
  });
});
