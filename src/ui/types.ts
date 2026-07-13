import { TFile } from 'obsidian';

export interface FileStatus {
    file?: TFile;
    path: string;
    status: 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'checking';
    localContent?: string | ArrayBuffer;
    remoteContent?: string | ArrayBuffer;
    remoteSha?: string;
    /** True when the remote blob is a symbolic link (mode 120000). */
    isSymlink?: boolean;
}

export type FilterValue = 'all' | 'synced' | 'modified' | 'unsynced' | 'remote-only';
