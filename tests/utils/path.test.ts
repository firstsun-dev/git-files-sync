import { describe, it, expect } from 'vitest';
import { isBinaryPath, contentsEqual, BINARY_EXTENSIONS } from '../../src/utils/path';

describe('isBinaryPath', () => {
    describe('image formats', () => {
        it('detects legacy formats', () => {
            expect(isBinaryPath('photo.png')).toBe(true);
            expect(isBinaryPath('photo.jpg')).toBe(true);
            expect(isBinaryPath('photo.gif')).toBe(true);
            expect(isBinaryPath('photo.bmp')).toBe(true);
            expect(isBinaryPath('photo.webp')).toBe(true);
        });

        it('detects modern formats', () => {
            expect(isBinaryPath('photo.heic')).toBe(true);
            expect(isBinaryPath('photo.heif')).toBe(true);
            expect(isBinaryPath('photo.avif')).toBe(true);
            expect(isBinaryPath('photo.tiff')).toBe(true);
            expect(isBinaryPath('photo.tif')).toBe(true);
            expect(isBinaryPath('photo.jxl')).toBe(true);
        });
    });

    describe('audio formats', () => {
        it('detects common audio formats', () => {
            expect(isBinaryPath('song.mp3')).toBe(true);
            expect(isBinaryPath('song.wav')).toBe(true);
            expect(isBinaryPath('song.ogg')).toBe(true);
            expect(isBinaryPath('song.flac')).toBe(true);
            expect(isBinaryPath('song.aac')).toBe(true);
            expect(isBinaryPath('song.m4a')).toBe(true);
            expect(isBinaryPath('song.opus')).toBe(true);
            expect(isBinaryPath('song.aiff')).toBe(true);
        });
    });

    describe('video formats', () => {
        it('detects common video formats', () => {
            expect(isBinaryPath('video.mp4')).toBe(true);
            expect(isBinaryPath('video.webm')).toBe(true);
            expect(isBinaryPath('video.mov')).toBe(true);
            expect(isBinaryPath('video.mkv')).toBe(true);
            expect(isBinaryPath('video.avi')).toBe(true);
            expect(isBinaryPath('video.wmv')).toBe(true);
            expect(isBinaryPath('video.flv')).toBe(true);
            expect(isBinaryPath('video.m4v')).toBe(true);
        });
    });

    describe('archive formats', () => {
        it('detects archive formats', () => {
            expect(isBinaryPath('file.zip')).toBe(true);
            expect(isBinaryPath('file.tar')).toBe(true);
            expect(isBinaryPath('file.gz')).toBe(true);
            expect(isBinaryPath('file.bz2')).toBe(true);
            expect(isBinaryPath('file.xz')).toBe(true);
            expect(isBinaryPath('file.zst')).toBe(true);
            expect(isBinaryPath('file.7z')).toBe(true);
            expect(isBinaryPath('file.rar')).toBe(true);
        });
    });

    describe('font formats', () => {
        it('detects font formats including otf', () => {
            expect(isBinaryPath('font.ttf')).toBe(true);
            expect(isBinaryPath('font.otf')).toBe(true);
            expect(isBinaryPath('font.woff')).toBe(true);
            expect(isBinaryPath('font.woff2')).toBe(true);
        });
    });

    describe('database formats', () => {
        it('detects database files', () => {
            expect(isBinaryPath('data.sqlite')).toBe(true);
            expect(isBinaryPath('data.db')).toBe(true);
        });
    });

    describe('text files', () => {
        it('returns false for markdown', () => expect(isBinaryPath('note.md')).toBe(false));
        it('returns false for JSON', () => expect(isBinaryPath('settings.json')).toBe(false));
        it('returns false for TypeScript', () => expect(isBinaryPath('main.ts')).toBe(false));
        it('returns false for YAML', () => expect(isBinaryPath('config.yml')).toBe(false));
        it('returns false for plain text', () => expect(isBinaryPath('readme.txt')).toBe(false));
    });

    describe('hidden file paths', () => {
        it('returns false for dotfiles with no extension', () => {
            expect(isBinaryPath('.gitignore')).toBe(false);
            expect(isBinaryPath('.env')).toBe(false);
        });

        it('returns false for hidden directory text files', () => {
            expect(isBinaryPath('.claude/settings.json')).toBe(false);
            expect(isBinaryPath('.claude/CLAUDE.md')).toBe(false);
        });

        it('returns true for hidden directory binary files', () => {
            expect(isBinaryPath('.claude/photo.png')).toBe(true);
        });

        it('returns false for hidden file with no extension', () => {
            expect(isBinaryPath('.claude')).toBe(false);
        });
    });

    describe('case insensitivity', () => {
        it('handles uppercase extensions', () => {
            expect(isBinaryPath('photo.PNG')).toBe(true);
            expect(isBinaryPath('photo.JPG')).toBe(true);
            expect(isBinaryPath('font.TTF')).toBe(true);
        });

        it('handles mixed case extensions', () => {
            expect(isBinaryPath('photo.Heic')).toBe(true);
            expect(isBinaryPath('song.FLAC')).toBe(true);
        });
    });

    describe('BINARY_EXTENSIONS set completeness', () => {
        it('contains all major image formats', () => {
            ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'tif', 'tiff'].forEach(ext => {
                expect(BINARY_EXTENSIONS.has(ext), `missing: ${ext}`).toBe(true);
            });
        });

        it('contains all major audio formats', () => {
            ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus'].forEach(ext => {
                expect(BINARY_EXTENSIONS.has(ext), `missing: ${ext}`).toBe(true);
            });
        });

        it('contains both ttf and otf fonts', () => {
            expect(BINARY_EXTENSIONS.has('ttf')).toBe(true);
            expect(BINARY_EXTENSIONS.has('otf')).toBe(true);
        });
    });
});

describe('contentsEqual', () => {
    describe('string comparison', () => {
        it('returns true for identical strings', () => {
            expect(contentsEqual('hello', 'hello')).toBe(true);
        });

        it('returns false for different strings', () => {
            expect(contentsEqual('hello', 'world')).toBe(false);
        });

        it('returns true for empty strings', () => {
            expect(contentsEqual('', '')).toBe(true);
        });

        it('is case-sensitive', () => {
            expect(contentsEqual('Hello', 'hello')).toBe(false);
        });
    });

    describe('ArrayBuffer comparison', () => {
        it('returns true for identical buffers', () => {
            const bufA = new Uint8Array([1, 2, 3]).buffer;
            const bufB = new Uint8Array([1, 2, 3]).buffer;
            expect(contentsEqual(bufA, bufB)).toBe(true);
        });

        it('returns false for different buffers', () => {
            const bufA = new Uint8Array([1, 2, 3]).buffer;
            const bufB = new Uint8Array([1, 2, 4]).buffer;
            expect(contentsEqual(bufA, bufB)).toBe(false);
        });

        it('returns false for buffers of different length', () => {
            const bufA = new Uint8Array([1, 2, 3]).buffer;
            const bufB = new Uint8Array([1, 2]).buffer;
            expect(contentsEqual(bufA, bufB)).toBe(false);
        });

        it('returns true for two empty buffers', () => {
            expect(contentsEqual(new ArrayBuffer(0), new ArrayBuffer(0))).toBe(true);
        });
    });

    describe('mixed type comparison', () => {
        it('returns false when comparing string with ArrayBuffer', () => {
            const buf = new Uint8Array([1, 2, 3]).buffer;
            expect(contentsEqual('hello', buf)).toBe(false);
        });

        it('returns false when comparing ArrayBuffer with string', () => {
            const buf = new Uint8Array([1, 2, 3]).buffer;
            expect(contentsEqual(buf, 'hello')).toBe(false);
        });
    });
});
