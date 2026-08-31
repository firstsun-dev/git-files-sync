# Test Coverage

All tests are in `tests/` and run with `npm run test` (Vitest).

## Real-provider E2E

Real-provider E2E (GitHub/GitLab/Gitea, against a real Git server) lives under
`e2e-tests/provider/`, separate from the unit tests in `tests/`. See
`docs/testing/real-provider-e2e.md` and `docs/obsidian-scanner-audit.md`.

---

## utils/path — `tests/utils/path.test.ts`

### `isBinaryPath()`
| Group | Cases |
|---|---|
| Image formats | png, jpg, gif, bmp, webp (legacy); heic, heif, avif, tiff, tif, jxl (modern) |
| Audio formats | mp3, wav, ogg, flac, aac, m4a, opus, aiff |
| Video formats | mp4, webm, mov, mkv, avi, wmv, flv, m4v |
| Archive formats | zip, tar, gz, bz2, xz, zst, 7z, rar |
| Font formats | ttf, otf, woff, woff2 |
| Database formats | sqlite, db |
| Text files | md, json, ts, yml, txt → returns false |
| Hidden file paths | `.gitignore`, `.env` → false; `.claude/settings.json` → false; `.claude/photo.png` → true |
| Case insensitivity | `.PNG`, `.JPG`, `.FLAC` |
| BINARY_EXTENSIONS completeness | Set membership checks for major categories |

### `contentsEqual()`
| Group | Cases |
|---|---|
| String | identical, different, empty, case-sensitive |
| ArrayBuffer | identical, different bytes, different lengths, empty buffers |
| Mixed types | string vs ArrayBuffer → false |

---

## logic/SyncManager — `tests/logic/sync-manager.test.ts`

| Case |
|---|
| Push file content correctly |
| Detect conflict when remote SHA differs from last synced SHA |
| Resolve conflict by choosing local |
| Resolve conflict by choosing remote |
| Update metadata when file is already in sync (contentsEqual) |
| Update metadata after successful push |
| Pull and modify file content, update metadata |
| Handle file not existing in vault |
| Add new file to repo when exists locally but not on remote |
| **Renames:** detect and handle file rename |
| **Error handling:** push errors, rename errors |
| **pullFile:** file not in remote, pull new file, pull errors |

---

## logic/SyncManager Batch — `tests/logic/sync-manager-batch.test.ts`

| Case |
|---|
| Push multiple files (TFile and string paths) |
| Handle failures during batch push |
| Pull multiple files (TFile and string paths) |
| Handle missing remote files during batch pull |
| onProgress callback called for each file |
| Detect and handle rename during batch push |

---

## logic/SyncManager Path Mapping — `tests/logic/sync-manager-mapping.test.ts`

| Case |
|---|
| Strip vaultFolder prefix when pushing |
| Re-add vaultFolder prefix when pulling |
| Handle root-level files with no vaultFolder |

---

## logic/SyncManager Binary Files — `tests/logic/sync-manager-binary.test.ts`

### `pushFile` with binary path (string)
| Case |
|---|
| Reads via `adapter.readBinary` for binary extensions |
| Skips push when binary content is already in sync |
| Updates metadata when binary is already in sync |

### `pullFile` with binary content
| Case |
|---|
| Writes via `adapter.writeBinary` when remote content is ArrayBuffer |
| Creates parent directory before writing binary |
| Skips pull when binary content is already in sync |
| Updates metadata after pulling binary file |

---

## logic/SyncManager Hidden Files — `tests/logic/sync-manager-hidden.test.ts`

### `pullFile` with hidden paths
| Case |
|---|
| Creates single hidden parent directory (`.claude/`) on pull |
| Creates all nested hidden parent directories (`.claude/memory/`) on pull |
| Does not throw if hidden directory already exists (mkdir error is swallowed) |
| Updates syncMetadata after pulling hidden file |

### `pushFile` with hidden paths
| Case |
|---|
| Pushes hidden file content via string path |
| Skips push when hidden file is already in sync (same content) |
| Does not push when hidden file is missing from vault |

---

## logic/GitignoreManager — `tests/logic/gitignore-manager.test.ts`

### `loadGitignores()`
| Case |
|---|
| Load root .gitignore from local if it exists |
| Load gitignores from remote as fallback |
| Fall back to `[".gitignore"]` when getRepoGitignores throws |
| Fall back to remote when local .gitignore read throws |
| Handle subdirectory .gitignores correctly |
| Pick up local-only subdirectory .gitignore not yet on remote |

### `isIgnored()` with rootPath
| Case |
|---|
| Correctly resolve paths relative to git root |

### Complex patterns
| Case |
|---|
| Negative patterns (`!important.log`) |
| Directory-only patterns (`build/`) |
| Deep wildcards (`**/temp/*`) |

### Hidden file and directory filtering
| Case |
|---|
| Ignore hidden directory when listed in .gitignore (`.obsidian/`, `.trash/`) |
| Pass through hidden directory absent from .gitignore (`.claude/`) |
| Ignore `.claude/` when explicitly added to .gitignore |
| Pass normal files when only hidden dirs are ignored |
| Find `.gitignore` inside a hidden directory via scanDir |

---

## services/GitServiceBase — `tests/services/git-service-base.test.ts`

| Case |
|---|
| No double-slash when rootPath already ends with `/` |
| Wrap non-Error throws in a new Error |
| Correctly encode and decode UTF-8 content |

---

## services/GitHubService — `tests/services/github-service.test.ts`

| Group | Cases |
|---|---|
| getFile | fetch and decode content, 404 handling, bypass rootPath with `/` prefix, no double-prefix, return sha |
| pushFile | new file (no sha), update existing file (with sha) |
| listFiles | list blob files, filter by rootPath, no sibling path collision, truncated result warning |
| deleteFile | delete using file sha |

---

## services/GitLabService — `tests/services/gitlab-service.test.ts`

| Group | Cases |
|---|---|
| getFile | fetch and decode content, 404 handling, return last_commit_id as sha |
| pushFile | POST for new file, PUT for existing file |
| listFiles | list blob files, filter by rootPath, no sibling path collision, pagination boundary (100 items), multi-page (200 items), stop on partial page |
| deleteFile | delete with commit message |

---

## ui/ActionBar — `tests/ui/ActionBar.test.ts`

| Group | Cases |
|---|---|
| No files | always renders refresh button; no push/pull/delete; no select-all |
| Has files | renders push, pull, delete, select-all; disabled states when count is 0; enabled when count > 0 |
| Interactions | onRefresh, onPush, onPull, onDelete, onSelectAll(true/false) |

---

## ui/DiffPanel — `tests/ui/DiffPanel.test.ts`

| Case |
|---|
| Returns element with `ssv-diff` class |
| Renders Remote and Local column headers |
| Renders unchanged lines |
| Renders added line |
| Renders removed line |
| Renders replacement (removed + added) |
| Renders unchanged lines for identical content |

---

## ui/FileListItem — `tests/ui/FileListItem.test.ts`

| Group | Cases |
|---|---|
| Status CSS | distinct class for each status |
| Rendering | file path, status badge, checkbox (selected/unselected) |
| Interactions | onSelect(path, true/false) |
| Synced status | no action buttons |
| Remote-only status | no action buttons |
| Modified status | push + pull buttons; onPush/onPull callbacks; diff toggle; diff panel visibility toggle; diff button label toggle |
| Local-only status | push + delete buttons; no pull; onDelete callback |
| Missing status | pull button; no push |

---

## utils/diff — `tests/utils/diff.test.ts`

| Group | Cases |
|---|---|
| Identical content | single-line, multi-line, empty strings |
| CRLF normalisation | CRLF = LF, CR-only |
| Additions only | single added line, multiple added lines, single-line change |
| Removals only | single removed line, multiple removed lines |
| Mixed changes | paired removed+added, unchanged lines between changes |
| Line numbers | correct numbering |
