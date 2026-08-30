import en, { TranslationKey } from './locales/en';
import zhTw from './locales/zh-tw';
import zhCn from './locales/zh-cn';

export type { TranslationKey };

const locales: Record<string, Partial<Record<TranslationKey, string>>> = {
	en,
	'zh-tw': zhTw,
	'zh-cn': zhCn,
};

/** User-facing language choices exposed in the settings UI. 'system' follows Obsidian's display language. */
export type LanguageSetting = 'system' | 'en' | 'zh-tw' | 'zh-cn';

// Explicit language chosen in plugin settings, or 'system' (default) to follow
// Obsidian's display language. Set once at load via setLanguageOverride().
let languageOverride: LanguageSetting = 'system';

export function setLanguageOverride(language: LanguageSetting): void {
	languageOverride = language;
}

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
	if (rawLocale.startsWith('zh')) return rawLocale.includes('cn') ? 'zh-cn' : 'zh-tw';
	return 'en';
}

export function getActiveLocale(): string {
	if (languageOverride !== 'system') return languageOverride;
	return resolveLocale(detectMomentLocale());
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
	const dict = locales[getActiveLocale()] ?? en;
	const template = dict[key] ?? en[key];
	if (!vars) return template;
	return template.replace(/\{(\w+)(?:\|([^|]*)\|([^}]*))?\}/g, (match, name: string, singular: string | undefined, plural: string | undefined) => {
		if (!(name in vars)) return match;
		const value = String(vars[name]);
		// Inline plural form: '{count|conflict|conflicts}' renders the value
		// suffixed with the singular branch when it is exactly 1 and the
		// plural branch otherwise ('1 conflict' / '3 conflicts'). Locales
		// without inflection (zh) simply omit the |-branches.
		if (singular !== undefined && plural !== undefined) {
			return vars[name] === 1 ? `${value} ${singular}` : `${value} ${plural}`;
		}
		return value;
	});
}
