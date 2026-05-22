// Minimal stub so uploader.ts can be imported in the test environment
export const requestUrl = () => Promise.resolve({ headers: {}, status: 200, arrayBuffer: new ArrayBuffer(0) });
export type RequestUrlParam = unknown;
export class Notice { constructor(_msg: string) {} }
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class TextComponent {}
export const setIcon = () => {};
export class TFile {}
export class MarkdownView {}
export class Editor {}
