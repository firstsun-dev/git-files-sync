import { vi } from 'vitest';

// Mock global browser environment if not in JSDOM
if (typeof document === 'undefined') {
  (globalThis as unknown as { document: unknown }).document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createElement: vi.fn(() => ({
      classList: { add: vi.fn(), contains: vi.fn(), toggle: vi.fn() },
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
      textContent: '',
      type: 'text',
      empty() {},
    })),
  };
}
if (typeof window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = {
    setInterval: vi.fn(),
    clearInterval: vi.fn(),
  };
}

function createButtonElement(): HTMLButtonElement {
  return document.createElement('button');
}

export const Plugin = class {};
export const PluginSettingTab = class {
  app: unknown;
  plugin: unknown;
  containerEl: HTMLElement;

  constructor(app?: unknown, plugin?: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div') as HTMLElement;
  }
};

export const TextComponent = class {
  inputEl: HTMLInputElement;
  private changeHandler?: (value: string) => void;

  constructor(containerEl?: HTMLElement) {
    this.inputEl = document.createElement('input');
    containerEl?.appendChild(this.inputEl);
  }

  setPlaceholder(value: string) {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string) {
    this.inputEl.value = value;
    return this;
  }

  onChange(handler: (value: string) => void) {
    this.changeHandler = handler;
    return this;
  }

  triggerChange(value: string) {
    this.inputEl.value = value;
    this.changeHandler?.(value);
  }
};

export const TextAreaComponent = class {
  inputEl: HTMLTextAreaElement;
  private changeHandler?: (value: string) => void;

  constructor(containerEl?: HTMLElement) {
    this.inputEl = document.createElement('textarea');
    containerEl?.appendChild(this.inputEl);
  }

  setPlaceholder(value: string) {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string) {
    this.inputEl.value = value;
    return this;
  }

  onChange(handler: (value: string) => void) {
    this.changeHandler = handler;
    return this;
  }

  triggerChange(value: string) {
    this.inputEl.value = value;
    this.changeHandler?.(value);
  }
};

export const DropdownComponent = class {
  private changeHandler?: (value: string) => void;

  addOption() { return this; }
  setValue() { return this; }
  onChange(handler: (value: string) => void) {
    this.changeHandler = handler;
    return this;
  }
  triggerChange(value: string) {
    this.changeHandler?.(value);
  }
};

export const ButtonComponent = class {
  buttonEl: HTMLButtonElement;

  constructor(containerEl?: HTMLElement) {
    this.buttonEl = createButtonElement();
    containerEl?.appendChild(this.buttonEl);
  }

  setButtonText(text: string) {
    this.buttonEl.textContent = text;
    return this;
  }

  setTooltip(text: string) {
    this.buttonEl.title = text;
    return this;
  }

  setCta() {
    this.buttonEl.classList.add('mod-cta');
    return this;
  }

  setWarning() {
    this.buttonEl.classList.add('mod-warning');
    return this;
  }

  setDestructive() {
    this.buttonEl.classList.add('mod-destructive');
    return this;
  }

  setIcon(icon: string) {
    this.buttonEl.dataset.icon = icon;
    return this;
  }

  onClick(handler: () => void) {
    this.buttonEl.addEventListener('click', handler);
    return this;
  }
};

export const ExtraButtonComponent = class extends ButtonComponent {};

export const Setting = class {
  containerEl?: HTMLElement;

  constructor(containerEl?: HTMLElement) {
    this.containerEl = containerEl;
  }

  setName() { return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addToggle() { return this; }
  addText(callback?: (component: InstanceType<typeof TextComponent>) => void) {
    if (callback) callback(new TextComponent(this.containerEl));
    return this;
  }
  addTextArea(callback?: (component: InstanceType<typeof TextAreaComponent>) => void) {
    if (callback) callback(new TextAreaComponent(this.containerEl));
    return this;
  }
  addButton(callback?: (component: InstanceType<typeof ButtonComponent>) => void) {
    if (callback) callback(new ButtonComponent(this.containerEl));
    return this;
  }
  addExtraButton(callback?: (component: InstanceType<typeof ExtraButtonComponent>) => void) {
    if (callback) callback(new ExtraButtonComponent(this.containerEl));
    return this;
  }
  addDropdown(callback?: (component: InstanceType<typeof DropdownComponent>) => void) {
    if (callback) callback(new DropdownComponent());
    return this;
  }
};

export const Notice = class {
  constructor() {}
  setMessage() {}
  hide() {}
};

export const Modal = class {
  app: unknown;
  contentEl: HTMLElement;

  constructor(app?: unknown) {
    this.app = app;
    this.contentEl = document.createElement('div') as HTMLElement;
  }

  open() {
    const withOnOpen = this as unknown as { onOpen?: () => void };
    if (typeof withOnOpen.onOpen === 'function') {
      withOnOpen.onOpen();
    }
  }

  close() {
    const withOnClose = this as unknown as { onClose?: () => void };
    if (typeof withOnClose.onClose === 'function') {
      withOnClose.onClose();
    }
  }
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
    configDir: 'mock-config-dir',
    adapter: {
      getBasePath: vi.fn().mockReturnValue('/mock/path'),
    },
  };
};

export const TFile = class {};
export const requestUrl = vi.fn();
export const setTooltip = vi.fn();
export const setIcon = vi.fn();

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
  TextComponent,
  TextAreaComponent,
  DropdownComponent,
  ButtonComponent,
  ExtraButtonComponent,
  requestUrl,
  setTooltip,
  setIcon,
}));
