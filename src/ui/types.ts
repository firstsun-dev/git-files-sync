import { TFile } from 'obsidian';

export interface FileStatus {
    file?: TFile;
    path: string;
    status: 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'checking';
    localContent?: string | ArrayBuffer;
    remoteContent?: string | ArrayBuffer;
    remoteSha?: string;
    diff?: string;
}

export type FilterValue = 'all' | 'synced' | 'modified' | 'unsynced' | 'remote-only';
