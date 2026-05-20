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
