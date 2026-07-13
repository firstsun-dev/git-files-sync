import { describe, it, expect } from 'vitest';
import { compareVersions } from '../../src/utils/version';

describe('compareVersions', () => {
    it('returns 0 for equal versions', () => {
        expect(compareVersions('1.2.1', '1.2.1')).toBe(0);
    });

    it('compares patch versions', () => {
        expect(compareVersions('1.2.1', '1.2.0')).toBeGreaterThan(0);
        expect(compareVersions('1.2.0', '1.2.1')).toBeLessThan(0);
    });

    it('compares numerically, not lexically, across double-digit segments', () => {
        expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
        expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
    });

    it('treats a missing segment as 0', () => {
        expect(compareVersions('1.2', '1.2.0')).toBe(0);
        expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0);
    });

    it('treats a non-numeric segment as 0', () => {
        expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
    });
});
