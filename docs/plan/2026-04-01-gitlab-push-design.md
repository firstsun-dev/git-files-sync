# Design Spec: Obsidian GitLab Push Plugin

## Overview
A mobile-compatible Obsidian plugin for pushing and pulling individual notes to GitLab using Personal Access Tokens (PAT). Focuses on reliable sync, manual conflict resolution, and high test coverage.

## Core Architecture
- **Entry Point**: `src/main.ts` (Ribbon icons, Commands, File Menu items)
- **Service Layer**: `src/services/gitlab-service.ts` (GitLab REST API v4 using `requestUrl`)
- **Logic Layer**: `src/logic/sync-manager.ts` (Orchestrating SHA comparisons and vault operations)
- **UI Layer**: `src/ui/SyncConflictModal.ts` (Manual resolution dialog)

## Technical Details
### 1. Metadata Management
- Store `Record<filePath, { sha: string, lastSyncedAt: number }>` in plugin data.
- Used to detect remote changes since last local sync.

### 2. Sync Logic (Push/Pull Flow)
- **Push**: 
  1. Fetch remote SHA via `getFile` (or HEAD if optimized).
  2. Compare `remoteSha` with `lastSyncedSha`.
  3. If different -> Trigger `SyncConflictModal`.
  4. If user confirms or no remote file exists -> Update remote and save new SHA.
- **Pull**:
  1. Fetch remote content.
  2. Compare with local content.
  3. If different -> Overwrite local (or trigger modal if bi-directional changes detected).

### 3. Mobile Compatibility
- Use `obsidian.requestUrl` for all network requests.
- Avoid `fs` and `child_process`; use `this.app.vault.adapter` and `this.app.vault.read/modify`.

## Verification Plan (TDD)
- **Unit Tests (Vitest)**:
  - `GitLabService`: Mock `requestUrl` to verify 200/201 (Success), 401 (Auth Error), 404 (Missing Project) responses.
  - `SyncManager`: Verify conflict detection logic (Local SHA != Remote SHA).
  - `Encoding`: Ensure Base64 encoding/decoding handles UTF-8 correctly for mobile/desktop parity.
- **Integration Tests**:
  - Verify Ribbon icon and Commands are correctly registered in `main.ts` onload.

## Success Criteria
- [ ] Push successful with PAT.
- [ ] Conflict Modal triggers when remote is newer.
- [ ] All Vitest tests pass with 100% coverage on core logic.
- [ ] Mobile-safe (no Node-only APIs).
