// Minimal `window` alias so production code written for Obsidian's Electron
// renderer (e.g. window.setTimeout) runs as-is under Node.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}
