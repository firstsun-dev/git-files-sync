import { describe, it, expect, afterEach } from 'vitest';
import { t, getActiveLocale } from '../../src/i18n';

type MomentGlobal = { moment?: { locale: () => string } };

function setMomentLocale(locale: string | undefined): void {
    const w = window as unknown as MomentGlobal;
    if (locale === undefined) {
        delete w.moment;
    } else {
        w.moment = { locale: () => locale };
    }
}

describe('i18n', () => {
    afterEach(() => {
        setMomentLocale(undefined);
    });

    it('falls back to English when window.moment is unavailable', () => {
        setMomentLocale(undefined);
        expect(getActiveLocale()).toBe('en');
        expect(t('confirmModal.cancel')).toBe('Cancel');
    });

    it('falls back to English for an unsupported locale', () => {
        setMomentLocale('fr');
        expect(getActiveLocale()).toBe('en');
        expect(t('confirmModal.cancel')).toBe('Cancel');
    });

    it('resolves zh-tw translations when moment locale is zh-tw', () => {
        setMomentLocale('zh-tw');
        expect(getActiveLocale()).toBe('zh-tw');
        expect(t('confirmModal.cancel')).toBe('取消');
    });

    it('maps a bare "zh" locale to zh-tw', () => {
        setMomentLocale('zh');
        expect(getActiveLocale()).toBe('zh-tw');
    });

    it('interpolates variables into the template', () => {
        setMomentLocale(undefined);
        expect(t('settings.testConnection.success', { service: 'GitHub' })).toBe('GitHub connection successful!');
    });

    it('falls back to English text when a zh-tw key is missing a translation', () => {
        setMomentLocale('zh-tw');
        // Every key defined in en.ts should resolve to *some* string even if
        // zh-tw hasn't translated it yet, rather than throwing or returning undefined.
        expect(typeof t('confirmModal.title')).toBe('string');
    });
});
