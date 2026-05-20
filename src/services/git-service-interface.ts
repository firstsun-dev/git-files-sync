export interface GitFile {
    content: string | ArrayBuffer;
    sha: string;
}

export interface GitServiceInterface {
    updateConfig(...args: unknown[]): void;
    getFile(path: string, branch: string): Promise<GitFile>;
    pushFile(path: string, content: string | ArrayBuffer, branch: string, commitMessage: string, existingSha?: string): Promise<{ path: string, sha?: string }>;
    testConnection(): Promise<boolean>;
    listFiles(branch: string, useFilter?: boolean): Promise<string[]>;
    deleteFile(path: string, branch: string, commitMessage: string): Promise<void>;
    getRepoGitignores(branch: string): Promise<string[]>;
}
