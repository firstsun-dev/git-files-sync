import { ConnectionTestResult } from './git-service-base';

export interface GitFile {
    content: string | ArrayBuffer;
    /** The blob's git SHA — permanent blob identity, used to compare content across syncs. */
    sha: string;
    /** Provider-specific revision for write/concurrency control (e.g., GitLab's last_commit_id). */
    revision?: string;
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

/** One file's content to include in a batched multi-file commit. */
export interface BatchPushItem {
    /** Path relative to rootPath, same shape pushFile's `path` param takes. */
    path: string;
    content: string | ArrayBuffer;
    /**
     * Whether this path already existed on the remote before this push, per the
     * caller's pre-fetched tree. GitLab's Commits API and Gitea's contents API
     * both need this to choose action 'create' vs 'update'; GitHub's tree-based
     * commit ignores it (a tree entry upserts regardless).
     */
    existedRemotely?: boolean;
    /** Revision read during batch planning, used by GitLab's optimistic lock. */
    revision?: string;
}

/** Result for one file after a batch push completes. */
export interface BatchPushResult {
    path: string;
    /** New blob sha, when the provider can report it directly. */
    sha?: string;
}

/** One renamed file to commit as a real move: adds `newPath`, removes `oldPath`. */
export interface BatchMoveItem {
    /** Path relative to rootPath, as last synced on the remote. */
    oldPath: string;
    /** Path relative to rootPath, where the file now lives. */
    newPath: string;
    content: string | ArrayBuffer;
    /** Revision of oldPath read during batch planning, used by GitLab's optimistic lock. */
    oldRevision?: string;
}

/**
 * Everything one atomic multi-file commit should contain: writes (additions
 * and modifications — `existedRemotely` on each `BatchPushItem` picks
 * create vs update), real renames, and plain deletions, all landing in the
 * same provider mutation. Grouped as one object rather than positional
 * arrays so a caller can't accidentally transpose `moves`/`deletions`, and
 * so adding another change kind later doesn't shift existing parameters.
 */
export interface BatchCommitPlan {
    writes: BatchPushItem[];
    moves: BatchMoveItem[];
    /** Paths relative to rootPath to remove, same shape deleteBatch takes. */
    deletions: string[];
}

export interface GitServiceInterface {
    updateConfig(...args: unknown[]): void;
    getFile(path: string, branch: string): Promise<GitFile>;
    pushFile(path: string, content: string | ArrayBuffer, branch: string, commitMessage: string, existingSha?: string, existingRevision?: string): Promise<{ path: string, sha?: string }>;
    /** Returns the branch's current commit SHA when the provider can expose it cheaply. */
    getBranchHead?(branch: string): Promise<string>;
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
    /**
     * Push many files in a single commit. Optional: only providers with a way to
     * write multiple files atomically implement it; callers must fall back to
     * sequential pushFile calls when it's absent (mirrors pushSymlink?). Must be
     * atomic: on failure it throws rather than returning partial results, so the
     * caller can mark every item in the attempted batch as failed.
     */
    pushBatch?(items: BatchPushItem[], branch: string, commitMessage: string): Promise<BatchPushResult[]>;
    /**
     * Commits file writes, real renames (add new path, remove old path), and
     * plain deletions together in one commit. Optional: only providers with
     * a way to write multiple changes atomically implement it; callers must
     * fall back to sequential push/move/delete calls when it's absent.
     * Returns a result for every item in `plan.writes` then every item in
     * `plan.moves`, in that order (deletions produce no result entry). Must
     * be atomic: on failure it throws rather than partially committing.
     */
    commitBatch?(plan: BatchCommitPlan, branch: string, commitMessage: string): Promise<BatchPushResult[]>;
    deleteFile(path: string, branch: string, commitMessage: string): Promise<void>;
    /**
     * Delete many files in a single commit. Optional: only providers with a way
     * to write multiple changes atomically implement it; callers must fall back
     * to sequential deleteFile calls when it's absent (mirrors pushBatch?). Must
     * be atomic: on failure it throws rather than partially deleting, so the
     * caller can mark every path in the attempted batch as failed.
     */
    deleteBatch?(paths: string[], branch: string, commitMessage: string): Promise<void>;
    getRepoGitignores(branch: string): Promise<string[]>;
    /**
     * Fetches a blob's content directly by its git SHA (from a GitTreeEntry),
     * bypassing the path/ref-based Contents API. Used to lazily load a modified
     * file's remote content (e.g. to render a diff) once a SHA-based refresh has
     * already determined it differs from the local copy.
     */
    getBlob(sha: string, path: string): Promise<GitFile>;
}
