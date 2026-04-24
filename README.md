# Git File Push

An Obsidian plugin that enables seamless synchronization of individual notes with GitLab or GitHub repositories across mobile and desktop platforms.

## Features

- **Multiple Git Services**: Support for both GitLab and GitHub (user selectable)
- **Push to Remote**: Upload individual notes to your Git repository
- **Pull from Remote**: Download and sync notes from your repository
- **Batch Operations**: Push or pull all modified files at once
- **Sync Status View**: Visual dashboard showing all files' sync status with complete git diff
- **Conflict Resolution**: Visual diff viewer to compare local and remote versions when conflicts occur
- **Vault Folder Filter**: Optionally sync only files within a specific vault folder
- **Ribbon Icon**: Quick access button in the left sidebar for pushing the current note
- **Command Palette**: Commands for pushing and pulling files (single or batch)
- **Context Menu**: Right-click any file to push or pull directly from the file menu
- **Cross-Platform**: Works on both desktop and mobile versions of Obsidian
- **Sync Tracking**: Maintains metadata to track last synced SHA and timestamp for each file
- **Conflict Detection**: Automatically detects conflicts and prompts for resolution

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

### View Sync Status
- Click the list-checks icon in the left ribbon, or
- Use Command Palette: "Open sync status view"
- Click "Refresh Status" to check all files against the remote repository
- View complete git diff for modified files
- Push or pull individual files directly from the status view
- Use "Push All Modified" or "Pull All Modified" for batch operations

### Push Files
**Single file:**
- Click the cloud upload icon in the left ribbon, or
- Use Command Palette: "Push current file to GitLab/GitHub", or
- Right-click a file and select "Push to GitLab/GitHub"

**All files:**
- Use Command Palette: "Push all markdown files"
- Or use "Push All Modified" button in the sync status view

### Pull Files
**Single file:**
- Use Command Palette: "Pull current file from GitLab/GitHub", or
- Right-click a file and select "Pull from GitLab/GitHub"

**All files:**
- Use Command Palette: "Pull all markdown files"
- Or use "Pull All Modified" button in the sync status view

### Conflict Resolution
When a conflict is detected:
1. A modal will appear showing both local and remote versions
2. Review the differences in the diff viewer
3. Choose to keep either the local or remote version
4. The chosen version will be synced

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
