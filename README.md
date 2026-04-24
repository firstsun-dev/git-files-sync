# Git File Push

An Obsidian plugin that enables seamless synchronization of individual notes with GitLab or GitHub repositories across mobile and desktop platforms.

## Features

- **Multiple Git Services**: Support for both GitLab and GitHub (user selectable)
- **GitHub Organization Support**: Works with both personal and organization repositories
- **Push to Remote**: Upload individual notes to your Git repository
- **Pull from Remote**: Download and sync notes from your repository
- **Batch Operations**: Push or pull all modified files at once with progress tracking
- **Sync Status View**: Visual dashboard showing all files' sync status with complete git diff
- **Remote-Only Files Detection**: Shows files that exist on remote but not locally
- **Batch Selection**: Select multiple files for batch push/pull/delete operations
- **Status Filtering**: Filter files by sync status (All/Synced/Modified/Not in remote/Remote only)
- **Progress Bar**: Real-time progress indicator during sync operations
- **Last Sync Time**: Display when the last sync check was performed
- **Conflict Resolution**: Visual diff viewer to compare local and remote versions when conflicts occur
- **Vault Folder Filter**: Optionally sync only files within a specific vault folder
- **Ribbon Icon**: Quick access button in the left sidebar for pushing the current note
- **Command Palette**: Commands for pushing and pulling files (single or batch)
- **Context Menu**: Right-click any file to push or pull directly from the file menu
- **Cross-Platform**: Works on both desktop and mobile versions of Obsidian
- **Mobile Optimized**: Responsive UI design for small screens
- **Sync Tracking**: Maintains metadata to track last synced SHA and timestamp for each file
- **Conflict Detection**: Automatically detects conflicts and prompts for resolution
- **Auto-Refresh**: Automatically updates file status after push/pull operations

## Setup

1. Install the plugin in Obsidian
2. Open Settings → Git File Push
3. Select your preferred Git service (GitLab or GitHub)
4. Configure the settings based on your choice:

### GitLab Configuration
   - **GitLab Personal Access Token**: Create a token in GitLab (User Settings → Access Tokens) with "API" scope
   - **GitLab Base URL**: Defaults to `https://gitlab.com` (change if using self-hosted GitLab)
   - **Project ID**: Found in your GitLab project's overview page

### GitHub Configuration
   - **GitHub Personal Access Token**: Create a token in GitHub (Settings → Developer Settings → Personal Access Tokens) with "repo" scope
   - **Repository Owner**: Your GitHub username or organization name
   - **Repository Name**: Name of the GitHub repository

### Common Settings
   - **Branch**: The branch to sync with (defaults to `main`)
   - **Root Path**: Optional path prefix in the repository (e.g., "notes" to store files in a notes/ folder)
   - **Vault Folder**: Optional vault folder to sync (e.g., "sync" to only sync files in the sync/ folder, leave empty to sync all files)

## Usage

### Sync Status View

The Sync Status View is the main interface for managing your file synchronization.

**Opening the view:**
- Click the list-checks icon in the left ribbon, or
- Use Command Palette: "Open sync status view"

**Understanding the interface:**

1. **Service Information Panel**
   - Shows current service (GitLab/GitHub), branch, and vault folder
   - Displays last sync time

2. **Control Buttons**
   - **Refresh status**: Check all files against remote repository (shows progress bar)
   - **Select all**: Select all files in current filter view
   - **Deselect all**: Clear all selections
   - **Push selected (N)**: Push all selected files to remote
   - **Pull selected (N)**: Pull all selected files from remote
   - **Delete selected (N)**: Delete selected local files (with confirmation)

3. **Status Filters**
   - **All**: Show all files
   - **Synced**: Files that match remote (✓)
   - **Modified**: Files with local changes (⚠)
   - **Not in remote**: Local files not yet pushed (✗)
   - **Remote only**: Files on remote but not local (↓)

4. **File Status Summary**
   - Shows count of files in each status category

5. **File List**
   - Each file shows: checkbox, status icon, file path, and status text
   - Click checkbox to select files for batch operations
   - Files show different actions based on status:
     - **Modified files**: Show diff button, Push, and Pull buttons
     - **Not in remote**: Push to remote, Remove local file buttons
     - **Remote only**: Pull from remote button

**Workflow examples:**

*Sync all changes to remote:*
1. Click "Refresh status"
2. Review modified files
3. Click "Select all" or manually select files
4. Click "Push selected"

*Pull new files from remote:*
1. Click "Refresh status"
2. Click "Remote only" filter
3. Click "Select all"
4. Click "Pull selected"

*Clean up local files not in remote:*
1. Click "Refresh status"
2. Click "Not in remote" filter
3. Select unwanted files
4. Click "Delete selected"

### Push Files

**Single file:**
- Click the cloud upload icon in the left ribbon, or
- Use Command Palette: "Push current file to GitLab/GitHub", or
- Right-click a file and select "Push to GitLab/GitHub"
- Status updates automatically after push

**Multiple files:**
- Open Sync Status View
- Select files using checkboxes
- Click "Push selected (N)"
- Or use "Refresh status" and filter by "Modified" or "Not in remote"

### Pull Files

**Single file:**
- Use Command Palette: "Pull current file from GitLab/GitHub", or
- Right-click a file and select "Pull from GitLab/GitHub"
- Status updates automatically after pull

**Multiple files:**
- Open Sync Status View
- Select files using checkboxes
- Click "Pull selected (N)"
- Or filter by "Remote only" to see files only on remote

**Pull remote-only files:**
- These are files that exist on remote but not in your local vault
- Open Sync Status View → Click "Remote only" filter
- Select files and click "Pull selected" to download them

### Batch Operations

**Push all modified files:**
- Use Command Palette: "Push all markdown files"
- Confirms before pushing
- Shows progress during operation
- Auto-refreshes status when complete

**Pull all modified files:**
- Use Command Palette: "Pull all markdown files"
- Warns about overwriting local changes
- Shows progress during operation
- Auto-refreshes status when complete

### Conflict Resolution

When a conflict is detected:
1. A modal will appear showing both local and remote versions
2. Review the differences in the diff viewer
3. Choose to keep either the local or remote version
4. The chosen version will be synced
5. File status updates automatically

## Development

### Prerequisites
- Node.js v16 or higher
- npm or yarn

### Setup
```bash
# Clone the repository
git clone https://github.com/tianyao/gitlab-files-push.git

# Install dependencies
npm install

# Start development mode (watch mode)
npm run dev
```

### Available Commands
- `npm run dev` - Build in watch mode using esbuild
- `npm run build` - Type check and build for production
- `npm run lint` - Run ESLint checks
- `npm run test` - Run Vitest test suite
- `npm run test:ui` - Run tests with UI
- `npm run version` - Bump version in manifest.json and versions.json

### Manual Installation

Copy `main.js`, `manifest.json`, and `styles.css` (if exists) to your vault:
```
VaultFolder/.obsidian/plugins/git-file-push/
```

## Project Structure

- `src/main.ts` - Main plugin class and command registration
- `src/settings.ts` - Settings interface and configuration UI
- `src/services/gitlab-service.ts` - GitLab API integration
- `src/logic/sync-manager.ts` - Sync logic and conflict handling
- `esbuild.config.mjs` - Build configuration

## Releasing

1. Update `minAppVersion` in `manifest.json` if needed
2. Run `npm run version` to bump version numbers
3. Create a GitHub release with tag matching the version
4. Upload `manifest.json`, `main.js`, and `styles.css` as release assets

## Code Quality

- ESLint is configured with Obsidian-specific rules
- Run `npm run lint` to check for issues
- Husky pre-commit hooks ensure code quality

## License

0-BSD

## Author

[tianyao](https://github.com/tianyao)
