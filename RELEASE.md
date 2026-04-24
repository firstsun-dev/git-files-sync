# Release Guide

This guide explains how to create a new release for the Git File Push plugin.

## Prerequisites

- Ensure all changes are committed and pushed to the main branch
- All tests pass (`npm run test`)
- Build succeeds (`npm run build`)

## Release Process

### 1. Update Version

Run the version bump script:

```bash
# For patch version (1.0.0 -> 1.0.1)
npm version patch

# For minor version (1.0.0 -> 1.1.0)
npm version minor

# For major version (1.0.0 -> 2.0.0)
npm version major
```

This will:
- Update `package.json` version
- Update `manifest.json` version
- Update `versions.json` with the new version
- Create a git commit with the version bump

### 2. Update CHANGELOG.md

Edit `CHANGELOG.md` and add a new section for the version:

```markdown
## [1.0.1] - 2026-04-24

### Added
- New feature description

### Fixed
- Bug fix description

### Changed
- Change description

[1.0.1]: https://github.com/tianyao/gitlab-files-push/releases/tag/1.0.1
```

Commit the changelog:

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for v1.0.1"
```

### 3. Create and Push Tag

```bash
# Create a tag matching the version
git tag 1.0.1

# Push the tag to trigger the release workflow
git push origin 1.0.1
```

### 4. Automated Release

The GitHub Actions workflow will automatically:
1. Run tests
2. Build the plugin
3. Create a GitHub release
4. Upload `main.js`, `manifest.json`, and `styles.css` as release assets

### 5. Verify Release

1. Go to https://github.com/tianyao/git-file-push/releases
2. Verify the new release is created
3. Check that all three files are attached
4. Review the release notes

## Manual Release (if needed)

If the automated workflow fails, you can create a release manually:

1. Build the plugin:
   ```bash
   npm run build
   ```

2. Go to GitHub → Releases → Draft a new release
3. Choose the tag you created
4. Add release notes from CHANGELOG.md
5. Upload `main.js`, `manifest.json`, and `styles.css`
6. Publish the release

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes
- **MINOR** (0.x.0): New features, backwards compatible
- **PATCH** (0.0.x): Bug fixes, backwards compatible

## Troubleshooting

### Workflow fails on test

```bash
npm run test
```

Fix any failing tests before creating the release.

### Workflow fails on build

```bash
npm run build
```

Ensure the build succeeds locally.

### Tag already exists

```bash
# Delete local tag
git tag -d 1.0.1

# Delete remote tag
git push origin :refs/tags/1.0.1

# Create new tag
git tag 1.0.1
git push origin 1.0.1
```
