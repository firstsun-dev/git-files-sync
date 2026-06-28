export interface GitFile {
    content: string | ArrayBuffer;
    sha: string;
}

/** A file entry from the repository tree, with whether it is a symbolic link. */
export interface GitTreeEntry {
    path: string;
    symlink: boolean;
}

export interface GitServiceInterface {
    updateConfig(...args: unknown[]): void;
    getFile(path: string, branch: string): Promise<GitFile>;
    pushFile(path: string, content: string | ArrayBuffer, branch: string, commitMessage: string, existingSha?: string): Promise<{ path: string, sha?: string }>;
    testConnection(): Promise<boolean>;
    listFiles(branch: string, useFilter?: boolean): Promise<string[]>;
    /** Like listFiles but also reports which entries are symbolic links (mode 120000). */
    listFilesDetailed(branch: string, useFilter?: boolean): Promise<GitTreeEntry[]>;
    deleteFile(path: string, branch: string, commitMessage: string): Promise<void>;
    getRepoGitignores(branch: string): Promise<string[]>;
}
