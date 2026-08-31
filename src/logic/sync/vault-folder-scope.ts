/**
 * Pure `vaultFolder` path-mapping rules, shared by the plugin runtime
 * (`src/main.ts`) and the real-provider E2E fixtures
 * (`e2e-tests/provider/support/two-client-sync-scenario.ts`) so the two never
 * drift apart. `vaultFolder` scopes the Obsidian vault to a subfolder of the
 * local filesystem/vault-relative namespace; an empty `vaultFolder` means the
 * vault root already is the sync root, so every function here is a no-op.
 */

export function filterPathByVaultFolder(path: string, vaultFolder: string): boolean {
    if (!vaultFolder) return true;
    const folderPath = `${vaultFolder}/`;
    return path.startsWith(folderPath) || path === vaultFolder;
}

export function filterFilesByVaultFolder<T extends { path: string }>(files: T[], vaultFolder: string): T[] {
    if (!vaultFolder) return files;
    return files.filter(file => filterPathByVaultFolder(file.path, vaultFolder));
}

/** Vault-relative path -> repo-relative path (strips the `vaultFolder` prefix). */
export function getNormalizedVaultPath(path: string, vaultFolder: string): string {
    if (!vaultFolder) return path;
    const folderPath = `${vaultFolder}/`;
    if (path.startsWith(folderPath)) return path.substring(folderPath.length);
    return path === vaultFolder ? '' : path;
}

/** Repo-relative path -> vault-relative path (re-adds the `vaultFolder` prefix). */
export function getVaultPathFromNormalized(normalizedPath: string, vaultFolder: string): string {
    if (!vaultFolder) return normalizedPath;
    if (!normalizedPath) return vaultFolder;
    return `${vaultFolder}/${normalizedPath}`;
}
