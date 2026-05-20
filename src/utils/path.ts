export const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'pdf', 'zip', 'gz', '7z', 'rar',
    'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi', 'wmv', 'webp',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'exe', 'dll', 'so',
    'ttf', 'woff', 'woff2', 'eot', 'wasm', 'dmg', 'iso'
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
