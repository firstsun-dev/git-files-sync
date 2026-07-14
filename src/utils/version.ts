/**
 * Compares two dot-separated version strings numerically per segment (so
 * "1.10.0" sorts after "1.9.0", unlike a plain string comparison). Missing or
 * non-numeric segments are treated as 0. Returns <0, 0, or >0 like a standard
 * comparator.
 */
export function compareVersions(a: string, b: string): number {
    const partsA = a.split('.');
    const partsB = b.split('.');
    const length = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < length; i++) {
        const numA = Number(partsA[i]) || 0;
        const numB = Number(partsB[i]) || 0;
        if (numA !== numB) return numA - numB;
    }
    return 0;
}
