import { vi } from 'vitest';

// Mock global browser environment if not in JSDOM
if (typeof document === 'undefined') {
  (globalThis as unknown as { document: unknown }).document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}
if (typeof window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = {
    setInterval: vi.fn(),
    clearInterval: vi.fn(),
  };
}

// Mock Obsidian API components
export const Plugin = class {};
export const PluginSettingTab = class {
  constructor() {}
};
export const Setting = class {
  constructor() {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addButton() { return this; }
};
export const Notice = class {
  constructor() {}
};
export const Modal = class {
  constructor() {}
  open() {}
  close() {}
};
export const MarkdownView = class {};
export const Editor = class {};
export const App = class {
  workspace = {
    getActiveViewOfType: vi.fn(),
    on: vi.fn(),
  };
  vault = {
    read: vi.fn(),
    modify: vi.fn(),
    getFileByPath: vi.fn(),
    on: vi.fn(),
    adapter: {
      getBasePath: vi.fn().mockReturnValue('/mock/path'),
    },
  };
};

export const TFile = class {};
export const requestUrl = vi.fn();

vi.mock('obsidian', () => ({
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  MarkdownView,
  Editor,
  App,
  TFile,
  requestUrl,
}));
