# GitLab Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a mobile-compatible GitLab push/pull plugin with metadata-driven conflict resolution.

**Architecture:** Use a `SyncManager` to coordinate between `GitLabService` (API) and Obsidian's Vault, tracking file versions via SHAs in plugin metadata.

**Tech Stack:** TypeScript, Obsidian API, Vitest.

---

### Task 1: Update Metadata Structure in Settings

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add syncMetadata to settings interface**

```typescript
export interface SyncMetadata {
    sha: string;
    lastSyncedAt: number;
}

export interface GitLabFilesPushSettings {
    gitlabToken: string;
    gitlabBaseUrl: string;
    projectId: string;
    branch: string;
    syncMetadata: Record<string, SyncMetadata>; // Add this
}

export const DEFAULT_SETTINGS: GitLabFilesPushSettings = {
    // ... existing
    syncMetadata: {}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add syncMetadata to settings"
```

### Task 2: Enhance GitLabService with Conflict Check Capability

**Files:**
- Modify: `src/services/gitlab-service.ts`
- Test: `tests/services/gitlab-service.test.ts`

- [ ] **Step 1: Write failing test for getFile metadata**

```typescript
it('should handle 404 correctly in getFile', async () => {
    (requestUrl as any).mockResolvedValue({ status: 404 });
    await expect(service.getFile('missing.md', 'main')).rejects.toThrow('404');
});
```

- [ ] **Step 2: Implement getFile robustness**
Ensure `getFile` returns the SHA (blob_id) correctly from GitLab response.

- [ ] **Step 3: Run tests**
Run: `npm run test`

### Task 3: Implement Conflict Detection in SyncManager

**Files:**
- Modify: `src/logic/sync-manager.ts`
- Test: `tests/logic/sync-manager.test.ts`

- [ ] **Step 1: Write test for conflict detection**

```typescript
it('should detect conflict when remote SHA differs from last synced SHA', async () => {
    const file = { path: 'conflict.md' } as any;
    manager['settings'].syncMetadata['conflict.md'] = { sha: 'old-sha', lastSyncedAt: 0 };
    mockGitLab.getFile.mockResolvedValue({ content: 'remote', sha: 'new-sha' });
    
    // Verify modal is called or error is thrown before integration
    await expect(manager.pushFile(file)).rejects.toThrow(); 
});
```

- [ ] **Step 2: Update pushFile logic**
Fetch remote SHA, compare with `settings.syncMetadata[path].sha`, and trigger `SyncConflictModal` if mismatch.

- [ ] **Step 3: Verify with tests**
Run: `npm run test`

### Task 4: Integrate SyncConflictModal

**Files:**
- Modify: `src/logic/sync-manager.ts`

- [ ] **Step 1: Implement Modal Callback**
Pass a callback to `SyncConflictModal` that either overwrites remote (POST/PUT) or pulls remote (`app.vault.modify`).

- [ ] **Step 2: Update metadata after successful sync**

```typescript
this.settings.syncMetadata[file.path] = {
    sha: newSha,
    lastSyncedAt: Date.now()
};
await this.plugin.saveSettings();
```

### Task 5: Mobile Compatibility Verification

- [ ] **Step 1: Audit for Node APIs**
Search for `fs`, `path` (as node module), `child_process`, `Buffer` (use `atob`/`btoa`).

- [ ] **Step 2: Final Lint and Build**
Run: `npm run lint && npm run build`
