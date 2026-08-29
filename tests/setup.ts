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
    // Delegate to the global timers (not bound methods captured once) so
    // vi.useFakeTimers()/vi.useRealTimers() — which patch globalThis — keep
    // controlling window.setTimeout/clearTimeout too.
    setTimeout: (handler: (...args: unknown[]) => void, timeout?: number) => globalThis.setTimeout(handler, timeout),
    clearTimeout: (handle?: ReturnType<typeof globalThis.setTimeout>) => globalThis.clearTimeout(handle),
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
    this.containerEl = document.createElement('div');
  }
};

class BaseTextComponent<T extends HTMLInputElement | HTMLTextAreaElement> {
  inputEl: T;
  protected changeHandler?: (value: string) => void;

  constructor(inputEl: T) {
    this.inputEl = inputEl;
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
}

export const TextComponent = class extends BaseTextComponent<HTMLInputElement> {
  constructor(containerEl?: HTMLElement) {
    const inputEl = document.createElement('input');
    containerEl?.appendChild(inputEl);
    super(inputEl);
  }
};

export const TextAreaComponent = class extends BaseTextComponent<HTMLTextAreaElement> {
  constructor(containerEl?: HTMLElement) {
    const inputEl = document.createElement('textarea');
    containerEl?.appendChild(inputEl);
    super(inputEl);
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

  setDisabled(disabled: boolean) {
    this.buttonEl.disabled = disabled;
    this.buttonEl.classList.toggle('is-disabled', disabled);
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
    this.contentEl = document.createElement('div');
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
export const WorkspaceLeaf = class {};
export const ItemView = class {
  app: unknown;
  leaf: unknown;
  containerEl: HTMLElement;

  constructor(leaf?: { app?: unknown }) {
    this.leaf = leaf;
    this.app = leaf?.app;
    // Real ItemView's containerEl has a header at children[0] and the
    // content root at children[1]; views render into the latter.
    this.containerEl = document.createElement('div');
    this.containerEl.appendChild(document.createElement('div'));
    this.containerEl.appendChild(document.createElement('div'));
  }

  registerEvent() {}
  register() {}
  registerDomEvent() {}
  registerInterval() {}
};
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
export const TFolder = class {};
export const AbstractInputSuggest = class {
  app: unknown;
  constructor(app: unknown) {
    this.app = app;
  }
  setValue() {}
  getValue() { return ''; }
  close() {}
  open() {}
};
export const requestUrl = vi.fn();
export const setTooltip = vi.fn();
export const setIcon = vi.fn();
// Real Keymap.isModEvent returns a PaneType or false; only the truthiness of
// "a modifier was held" matters to callers here.
export const Keymap = {
  isModEvent: (evt?: { ctrlKey?: boolean; metaKey?: boolean } | null): boolean =>
    Boolean(evt?.ctrlKey || evt?.metaKey),
};
// Mirrors Obsidian's debounce(): trailing-edge, with cancel()/run() attached.
export const debounce = <T extends unknown[]>(cb: (...args: T) => unknown, timeout = 0) => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const fn = (...args: T): void => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => cb(...args), timeout);
  };
  fn.cancel = (): typeof fn => { if (handle) clearTimeout(handle); return fn; };
  fn.run = (): typeof fn => fn;
  return fn;
};
// Mutable so tests can exercise both the desktop and mobile branches.
export const Platform = { isDesktopApp: true, isMobile: false };
export const FileSystemAdapter = class {
  getBasePath() { return '/mock/path'; }
};

vi.mock('obsidian', () => ({
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  MarkdownView,
  Editor,
  WorkspaceLeaf,
  ItemView,
  App,
  TFile,
  TFolder,
  AbstractInputSuggest,
  TextComponent,
  TextAreaComponent,
  DropdownComponent,
  ButtonComponent,
  ExtraButtonComponent,
  requestUrl,
  setTooltip,
  setIcon,
  Platform,
  FileSystemAdapter,
}));
