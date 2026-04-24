export interface GitServiceInterface {
    updateConfig(...args: unknown[]): void;
    getFile(path: string, branch: string): Promise<{ content: string; sha: string }>;
    pushFile(path: string, content: string, branch: string, commitMessage: string, existingSha?: string): Promise<string>;
    testConnection(): Promise<void>;
}
