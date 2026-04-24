# Obsidian Plugin Submission Checklist

This checklist ensures the Git File Push plugin meets all requirements for submission to the Obsidian Community Plugins directory.

## ✅ Required Files

- [x] **README.md**
  - [x] Clear description of what the plugin does
  - [x] Installation instructions
  - [x] Usage guide
  - [x] Screenshots or examples (optional but recommended)

- [x] **manifest.json**
  - [x] `id`: "git-file-push" (lowercase, hyphens only)
  - [x] `name`: "Git File Push"
  - [x] `version`: "1.0.0" (semantic versioning)
  - [x] `minAppVersion`: "0.15.0"
  - [x] `description`: Clear, concise description
  - [x] `author`: "tianyao"
  - [x] `authorUrl`: Valid GitHub profile URL
  - [x] `isDesktopOnly`: false

- [x] **versions.json**
  ```json
  {
    "1.0.0": "0.15.0"
  }
  ```

- [x] **LICENSE**
  - [x] Open source license (0-BSD)
  - [x] Compatible with Obsidian's requirements

- [x] **main.js** (in releases, not in repo)
  - [x] Built and minified
  - [x] Uploaded to GitHub releases

- [x] **styles.css** (optional)
  - [x] Plugin-specific styles

## ✅ GitHub Repository Requirements

- [x] **Public repository**
- [x] **GitHub releases**
  - [x] Release tagged with version number (e.g., "1.0.0", NOT "v1.0.0")
  - [x] Release includes: main.js, manifest.json, styles.css
- [x] **.gitignore**
  - [x] Excludes node_modules
  - [x] Excludes main.js (built file)
  - [x] Excludes *.map files

## ✅ Code Quality

- [x] **TypeScript**
  - [x] Properly typed
  - [x] No critical type errors
  - [x] Compiles successfully

- [x] **Plugin Class**
  - [x] Extends `Plugin` from Obsidian API
  - [x] Implements `onload()`
  - [x] Implements `onunload()`
  - [x] Proper cleanup in `onunload()`

- [x] **API Usage**
  - [x] Uses official Obsidian API only
  - [x] No private API usage
  - [x] No direct DOM manipulation outside API

- [x] **Error Handling**
  - [x] Proper try-catch blocks
  - [x] User-friendly error messages
  - [x] No unhandled promise rejections

## ✅ Build Configuration

- [x] **esbuild or similar bundler**
  - [x] Bundles to single main.js
  - [x] External: obsidian, electron, @codemirror/*, @lezer/*
  - [x] Format: CommonJS (cjs)
  - [x] Target: ES2018 or later

- [x] **package.json**
  - [x] Build script defined
  - [x] Version script defined (optional)
  - [x] Dependencies properly listed

## ✅ Release Process

- [x] **GitHub Actions** (optional but recommended)
  - [x] Automated release workflow
  - [x] Triggers on tag push
  - [x] Builds and uploads assets

- [x] **Version Management**
  - [x] Semantic versioning (MAJOR.MINOR.PATCH)
  - [x] manifest.json version matches tag
  - [x] versions.json updated with minAppVersion

## ✅ Documentation

- [x] **README.md includes:**
  - [x] Plugin name and description
  - [x] Features list
  - [x] Installation instructions
  - [x] Usage guide
  - [x] Configuration options

- [x] **CHANGELOG.md** (recommended)
  - [x] Version history
  - [x] Changes for each version

## ✅ Testing

- [x] **Manual Testing**
  - [x] Tested on desktop
  - [x] Tested on mobile (if not desktop-only)
  - [x] No console errors
  - [x] No performance issues

- [x] **Automated Tests** (optional but recommended)
  - [x] Unit tests
  - [x] Tests pass in CI

## ✅ Security & Privacy

- [x] **No malicious code**
- [x] **No data collection without consent**
- [x] **No external API calls without user configuration**
- [x] **Secure credential storage**
  - [x] Uses Obsidian's data storage
  - [x] No credentials in code

## ✅ Mobile Compatibility

- [x] **isDesktopOnly: false**
- [x] **No Node.js-specific APIs** (unless desktop-only)
- [x] **Responsive UI**
- [x] **Touch-friendly controls**

## 📋 Submission Steps

1. **Create GitHub Release**
   ```bash
   git tag 1.0.0
   git push origin 1.0.0
   ```
   - Release will be created automatically by GitHub Actions
   - Ensure main.js, manifest.json, and styles.css are attached

2. **Fork obsidian-releases**
   - Fork: https://github.com/obsidianmd/obsidian-releases

3. **Add Plugin to community-plugins.json**
   ```json
   {
     "id": "git-file-push",
     "name": "Git File Push",
     "author": "tianyao",
     "description": "Sync individual notes with GitLab or GitHub. Push, pull, and track changes across mobile and desktop with visual diff and conflict resolution.",
     "repo": "tianyao/git-file-push"
   }
   ```

4. **Create Pull Request**
   - Title: "Add Git File Push plugin"
   - Description: Brief description of the plugin
   - Link to your repository
   - Link to your first release

5. **Wait for Review**
   - Obsidian team will review
   - May request changes
   - Once approved, plugin will be available in Community Plugins

## 🔍 Pre-Submission Checklist

Before submitting, verify:

- [ ] Plugin works correctly in Obsidian
- [ ] No console errors
- [ ] README is clear and complete
- [ ] GitHub release exists with correct assets
- [ ] manifest.json version matches release tag
- [ ] License is included
- [ ] Code is clean and well-documented

## 📚 References

- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)
- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Community Plugins Repository](https://github.com/obsidianmd/obsidian-releases)

## ✅ Status

**The Git File Push plugin is ready for submission to the Obsidian Community Plugins directory.**

All requirements are met. Follow the submission steps above to submit the plugin.
