export interface GitServiceInterface {
    updateConfig(...args: unknown[]): void;
    getFile(path: string, branch: string): Promise<{ content: string; sha: string }>;
    pushFile(path: string, content: string, branch: string, commitMessage: string, existingSha?: string): Promise<string>;
    testConnection(): Promise<boolean>;
    listFiles(branch: string, path?: string): Promise<string[]>;
    deleteFile(path: string, branch: string, commitMessage: string): Promise<void>;
    getRepoGitignores(branch: string): Promise<string[]>;
}
