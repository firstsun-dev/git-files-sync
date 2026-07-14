import en, { TranslationKey } from './locales/en';
import zhTw from './locales/zh-tw';

export type { TranslationKey };

const locales: Record<string, Partial<Record<TranslationKey, string>>> = {
	en,
	'zh-tw': zhTw,
};

// Obsidian sets window.moment's locale to match the app's display language
// before plugins load. Not typed in the `obsidian` package, so read it off
// the global defensively.
function detectMomentLocale(): string {
	const w = window as unknown as { moment?: { locale: () => string } };
	try {
		return w.moment?.locale()?.toLowerCase() ?? '';
	} catch {
		return '';
	}
}

// Maps a moment locale code to one of our shipped locales, falling back to
// English when there's no matching translation.
function resolveLocale(rawLocale: string): string {
	if (rawLocale in locales) return rawLocale;
	if (rawLocale.startsWith('zh')) return 'zh-tw';
	return 'en';
}

export function getActiveLocale(): string {
	return resolveLocale(detectMomentLocale());
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
	const dict = locales[getActiveLocale()] ?? en;
	const template = dict[key] ?? en[key];
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in vars ? String(vars[name]) : match
	);
}
