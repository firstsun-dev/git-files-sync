import { describe, expect, it } from 'vitest';
import { findCompatibilityViolations } from '../../scripts/check-obsidian-compat.mjs';

describe('findCompatibilityViolations', () => {
    it('accepts a bundle with no Node built-ins or native fetch calls', () => {
        expect(findCompatibilityViolations('const request = require("obsidian").requestUrl; request({ url: "https://example.test" });'))
            .toEqual([]);
    });

    it('finds imported Node built-ins', () => {
        expect(findCompatibilityViolations('const crypto = require("node:crypto");'))
            .toEqual(['node:crypto']);
    });

    it('finds a direct native fetch call but not a property named fetch', () => {
        expect(findCompatibilityViolations('fetch("https://example.test"); client.fetch("/path");'))
            .toEqual(['native fetch']);
    });

    it('does not inspect comments', () => {
        expect(findCompatibilityViolations('// require("node:crypto")\n// fetch("https://example.test")'))
            .toEqual([]);
    });
});
