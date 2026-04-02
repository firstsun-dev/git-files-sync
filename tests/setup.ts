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
  constructor(_app: unknown, _plugin: unknown) {}
};
export const Setting = class {
  constructor(_containerEl: unknown) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  addText(_cb: unknown) { return this; }
  addToggle(_cb: unknown) { return this; }
  addButton(_cb: unknown) { return this; }
};
export const Notice = class {
  constructor(message: string) {}
};
export const Modal = class {
  constructor(_app: unknown) {}
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
}));
