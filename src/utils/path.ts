export const BINARY_EXTENSIONS = new Set([
    // Images
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',
    'tif', 'tiff', 'heic', 'heif', 'avif', 'jxl',
    // Documents
    'pdf', 'epub',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'odt', 'ods', 'odp',
    // Archives
    'zip', 'gz', 'tar', 'bz2', 'xz', 'zst', '7z', 'rar',
    // Audio
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'aiff',
    // Video
    'mp4', 'webm', 'mov', 'avi', 'wmv', 'mkv', 'flv', 'm4v',
    // Fonts
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    // Executables & binaries
    'exe', 'dll', 'so', 'wasm', 'dmg', 'iso', 'apk', 'deb', 'rpm',
    // Databases
    'sqlite', 'db',
    // Design
    'psd', 'sketch', 'fig',
]);

export function isBinaryPath(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase();
    if (!ext) return false;
    return BINARY_EXTENSIONS.has(ext);
}

export function contentsEqual(a: string | ArrayBuffer, b: string | ArrayBuffer): boolean {
    if (typeof a === 'string' && typeof b === 'string') return a === b;
    if (typeof a !== typeof b) return false;
    const bufA = a as ArrayBuffer;
    const bufB = b as ArrayBuffer;
    if (bufA.byteLength !== bufB.byteLength) return false;
    const viewA = new Uint8Array(bufA);
    const viewB = new Uint8Array(bufB);
    for (let i = 0; i < viewA.length; i++) {
        if (viewA[i] !== viewB[i]) return false;
    }
    return true;
}
