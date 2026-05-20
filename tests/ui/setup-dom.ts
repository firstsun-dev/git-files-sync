/**
 * Sets up a JSDOM environment for DOM-based tests running in the node vitest environment.
 * Call `setupObsidianDOM()` inside `beforeAll`, and use `createContainer()` for fresh roots.
 */
import { JSDOM } from 'jsdom';

let dom: JSDOM;

export function setupObsidianDOM(): void {
    dom = new JSDOM('<!DOCTYPE html>');
    const { window } = dom;

    Object.assign(globalThis, {
        document:         window.document,
        window:           window,
        HTMLElement:      window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        Event:            window.Event,
        Text:             window.Text,
    });

    const proto = window.HTMLElement.prototype;
    if ('createEl' in proto) return;

    type DomOpts = { cls?: string; text?: string; type?: string };
    const toOpts = (o?: DomOpts | string): DomOpts => (typeof o === 'string' ? { cls: o } : o ?? {});

    function applyOpts(el: Element, o: DomOpts): void {
        if (o.cls) el.className = o.cls;
        if (o.text) el.textContent = o.text;
        if (o.type) (el as HTMLInputElement).type = o.type;
    }

    Object.assign(proto, {
        createEl<K extends keyof HTMLElementTagNameMap>(tag: K, opts?: DomOpts | string): HTMLElementTagNameMap[K] {
            const el = window.document.createElement(tag);
            applyOpts(el, toOpts(opts));
            (this as HTMLElement).appendChild(el);
            return el as unknown as HTMLElementTagNameMap[K];
        },
        createDiv(opts?: DomOpts | string): HTMLDivElement {
            const el = window.document.createElement('div');
            applyOpts(el, toOpts(opts));
            (this as HTMLElement).appendChild(el);
            return el as unknown as HTMLDivElement;
        },
        createSpan(opts?: DomOpts | string): HTMLSpanElement {
            const el = window.document.createElement('span');
            applyOpts(el, toOpts(opts));
            (this as HTMLElement).appendChild(el);
            return el as unknown as HTMLSpanElement;
        },
        hasClass(cls: string): boolean {
            return (this as HTMLElement).classList.contains(cls);
        },
        toggleClass(cls: string, value: boolean): void {
            (this as HTMLElement).classList.toggle(cls, value);
        },
        setText(text: string): void {
            (this as HTMLElement).textContent = text;
        },
    });
}

export function createContainer(): HTMLElement {
    return dom.window.document.createElement('div') as unknown as HTMLElement;
}
