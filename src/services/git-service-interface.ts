import { ConnectionTestResult } from './git-service-base';

export interface GitFile {
    content: string | ArrayBuffer;
    sha: string;
    /** True when the remote blob is a symbolic link (mode 120000). */
    isSymlink?: boolean;
    /** The link target path, when isSymlink is true and it could be determined. */
    symlinkTarget?: string;
}

/** A file entry from the repository tree, with whether it is a symbolic link. */
export interface GitTreeEntry {
    path: string;
    symlink: boolean;
    /**
     * The blob's git SHA, when the provider's tree listing includes it. Lets a
     * refresh classify sync status by comparing a locally-computed blob SHA
     * against this, instead of fetching full file content per entry. Absent
     * entries fall back to a content-based comparison via getFile.
     */
    sha?: string;
}

export interface GitServiceInterface {
    updateConfig(...args: unknown[]): void;
    getFile(path: string, branch: string): Promise<GitFile>;
    pushFile(path: string, content: string | ArrayBuffer, branch: string, commitMessage: string, existingSha?: string): Promise<{ path: string, sha?: string }>;
    /** Checks the repository is reachable and the given branch exists. */
    testConnection(branch: string): Promise<ConnectionTestResult>;
    listFiles(branch: string, useFilter?: boolean): Promise<string[]>;
    /** Like listFiles but also reports which entries are symbolic links (mode 120000). */
    listFilesDetailed(branch: string, useFilter?: boolean): Promise<GitTreeEntry[]>;
    /**
     * Push a file as a symbolic link (Git blob mode 120000) whose content is the
     * target path. Optional: only providers with a full Git Data API (GitHub)
     * implement it; callers must fall back to pushFile when it's absent.
     */
    pushSymlink?(path: string, target: string, branch: string, commitMessage: string): Promise<{ path: string, sha?: string }>;
    deleteFile(path: string, branch: string, commitMessage: string): Promise<void>;
    getRepoGitignores(branch: string): Promise<string[]>;
    /**
     * Fetches a blob's content directly by its git SHA (from a GitTreeEntry),
     * bypassing the path/ref-based Contents API. Used to lazily load a modified
     * file's remote content (e.g. to render a diff) once a SHA-based refresh has
     * already determined it differs from the local copy.
     */
    getBlob(sha: string, path: string): Promise<GitFile>;
}
