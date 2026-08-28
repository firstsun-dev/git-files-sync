import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS, GitLabSyncSettingTab } from '../../src/settings';
import GitLabFilesPush from '../../src/main';
import type { ConnectionTestResult } from '../../src/services/git-service-base';
import { createContainer, setupObsidianDOM } from './setup-dom';

vi.mock('../../src/main', () => ({
  default: class {},
}));

beforeAll(() => { setupObsidianDOM(); });

// Mirrors the connection-status pub/sub that main.ts owns (onConnectionStatusChange
// / testConnection), since src/main is mocked out above and the settings tab now
// delegates to the plugin instead of running its own connection test.
function createPluginStub(testConnection: () => Promise<ConnectionTestResult>): GitLabFilesPush {
  let connectionStatus: { state: string; detail?: string } = { state: 'checking' };
  const listeners = new Set<(status: typeof connectionStatus) => void>();

  return {
    settings: { ...DEFAULT_SETTINGS },
    manifest: { version: '0.0.0-test' },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    initializeGitService: vi.fn(),
    gitService: { testConnection },
    onConnectionStatusChange: vi.fn((listener: (status: typeof connectionStatus) => void) => {
      listeners.add(listener);
      listener(connectionStatus);
      return () => listeners.delete(listener);
    }),
    testConnection: vi.fn(async () => {
      connectionStatus = { state: 'checking' };
      for (const listener of listeners) listener(connectionStatus);

      const result = await testConnection();
      if (!result.repoOk) {
        connectionStatus = { state: 'disconnected', detail: result.error ?? 'unreachable' };
      } else if (!result.branchOk) {
        connectionStatus = { state: 'disconnected', detail: 'branch not found' };
      } else {
        connectionStatus = { state: 'connected' };
      }
      for (const listener of listeners) listener(connectionStatus);
      return result;
    }),
  } as unknown as GitLabFilesPush;
}

function scheduleConnectionTest(tab: GitLabSyncSettingTab): void {
  (tab as unknown as { scheduleConnectionTest: () => void }).scheduleConnectionTest();
}

describe('GitLabSyncSettingTab connection status badge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows checking then connected after opening the tab', async () => {
    const testConnection = vi.fn().mockResolvedValue({ repoOk: true, branchOk: true });
    const tab = new GitLabSyncSettingTab(new App(), createPluginStub(testConnection));
    tab.containerEl = createContainer();

    tab.display();

    const badge = tab.containerEl.querySelector('.gfs-connection-status') as HTMLElement;
    expect(badge.classList.contains('is-checking')).toBe(true);

    await vi.advanceTimersByTimeAsync(800);

    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(badge.classList.contains('is-connected')).toBe(true);
    expect(badge.textContent).toBe('Connected');

    vi.useRealTimers();
  });

  it('debounces repeated field edits into a single connection test', async () => {
    const testConnection = vi.fn().mockResolvedValue({ repoOk: false, branchOk: false, error: 'bad token' });
    const plugin = createPluginStub(testConnection);
    const tab = new GitLabSyncSettingTab(new App(), plugin);
    tab.containerEl = createContainer();

    tab.display();
    await vi.advanceTimersByTimeAsync(800);
    testConnection.mockClear();

    // Simulate rapid keystrokes in the token field via the debounced hook directly.
    scheduleConnectionTest(tab);
    scheduleConnectionTest(tab);
    scheduleConnectionTest(tab);

    await vi.advanceTimersByTimeAsync(799);
    expect(testConnection).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(testConnection).toHaveBeenCalledTimes(1);

    const badge = tab.containerEl.querySelector('.gfs-connection-status') as HTMLElement;
    expect(badge.classList.contains('is-disconnected')).toBe(true);
    expect(badge.textContent).toContain('bad token');

    vi.useRealTimers();
  });
});

describe('GitLabSyncSettingTab ignore patterns setting', () => {
  it('renders a textarea seeded with the saved ignorePatterns value', async () => {
    const plugin = createPluginStub(vi.fn().mockResolvedValue({ repoOk: true, branchOk: true }));
    plugin.settings.ignorePatterns = 'draft/\n*.tmp';
    const tab = new GitLabSyncSettingTab(new App(), plugin);
    tab.containerEl = createContainer();

    vi.useFakeTimers();
    tab.display();
    await vi.advanceTimersByTimeAsync(800);
    vi.useRealTimers();

    const textarea = tab.containerEl.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('draft/\n*.tmp');
  });
});

describe('GitLabSyncSettingTab release history', () => {
  it('keeps release history accessible after the current-version banner was dismissed', () => {
    vi.useFakeTimers();
    const plugin = createPluginStub(vi.fn().mockResolvedValue({ repoOk: true, branchOk: true }));
    plugin.manifest = { version: '1.5.0' } as GitLabFilesPush['manifest'];
    plugin.settings.bannerDismissedVersion = '1.5.0';
    const tab = new GitLabSyncSettingTab(new App(), plugin);
    tab.containerEl = createContainer();

    try {
      tab.display();

      expect(tab.containerEl.querySelector('.gfs-whats-new-banner')).toBeNull();
      const buttons = Array.from(tab.containerEl.querySelectorAll('button'));
      expect(buttons.some(button => button.textContent === 'View release history')).toBe(true);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
