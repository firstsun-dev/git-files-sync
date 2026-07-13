/**
 * Computes a file's git blob SHA-1 locally: sha1("blob " + byteLength + "\0" + contentBytes).
 * This is exactly what `git hash-object` produces, so it can be compared directly
 * against a tree entry's SHA to classify sync status without fetching remote
 * content. Uses the Web Crypto API (crypto.subtle), available on both desktop
 * and mobile.
 */
export async function gitBlobSha(content: string | ArrayBuffer): Promise<string> {
    const contentBytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    const header = new TextEncoder().encode(`blob ${contentBytes.byteLength}\0`);

    const combined = new Uint8Array(header.byteLength + contentBytes.byteLength);
    combined.set(header, 0);
    combined.set(contentBytes, header.byteLength);

    // SHA-1 isn't for security here — it's required because it's git's own
    // object-hashing algorithm, so this must match `git hash-object` exactly.
    // eslint-disable-next-line sonarjs/hashing
    const digest = await crypto.subtle.digest('SHA-1', combined);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
