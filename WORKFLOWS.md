# GitHub Actions Workflows

This project includes automated workflows for continuous integration and releases.

## Workflows

### 1. Check (`.github/workflows/check.yml`)

Runs on every push and pull request to main/master/develop branches.

**Jobs:**
- **Lint**: Runs ESLint to check code quality
- **Test**: Runs the test suite with coverage
- **Build**: Builds the plugin and uploads artifacts

**Triggers:**
- Push to main, master, or develop branches
- Pull requests to main, master, or develop branches

### 2. Auto Release (`.github/workflows/auto-release.yml`)

Automatically bumps version, creates a tag, and publishes a release.

**How to use:**
1. Go to GitHub → Actions → Auto Release
2. Click "Run workflow"
3. Select version bump type:
   - **patch**: Bug fixes (1.0.0 → 1.0.1)
   - **minor**: New features (1.0.0 → 1.1.0)
   - **major**: Breaking changes (1.0.0 → 2.0.0)
4. Click "Run workflow"

**What it does:**
1. Runs tests
2. Bumps version in package.json, manifest.json, and versions.json
3. Updates CHANGELOG.md
4. Commits and pushes changes
5. Creates and pushes a git tag
6. Creates a GitHub release
7. Uploads main.js, manifest.json, and styles.css

### 3. Release (`.github/workflows/release.yml`)

Triggered when you manually push a tag.

**How to use:**
```bash
# Create and push a tag
git tag 1.0.1
git push origin 1.0.1
```

**What it does:**
1. Runs tests
2. Builds the plugin
3. Creates a GitHub release
4. Uploads release assets

## Recommended Workflow

### For Regular Development

1. Make changes and commit to a feature branch
2. Create a pull request to main/master
3. The Check workflow will run automatically
4. Merge when all checks pass

### For Releases

**Option A: Automatic (Recommended)**
1. Go to GitHub Actions → Auto Release
2. Select version bump type
3. Click "Run workflow"
4. Done! The release is created automatically

**Option B: Manual**
1. Update version manually:
   ```bash
   npm run version
   ```
2. Update CHANGELOG.md
3. Commit changes:
   ```bash
   git add .
   git commit -m "chore: bump version to 1.0.1"
   git push
   ```
4. Create and push tag:
   ```bash
   git tag 1.0.1
   git push origin 1.0.1
   ```
5. The Release workflow will create the GitHub release

## Build Artifacts

After each successful build in the Check workflow, artifacts are uploaded and available for 7 days:
- main.js
- manifest.json
- styles.css

You can download these from the Actions tab → Select a workflow run → Artifacts section.

## Troubleshooting

### Workflow fails on test
```bash
npm run test
```
Fix any failing tests before releasing.

### Workflow fails on build
```bash
npm run build
```
Ensure the build succeeds locally.

### Permission denied errors
Make sure the repository has the correct permissions:
- Settings → Actions → General → Workflow permissions
- Select "Read and write permissions"
- Check "Allow GitHub Actions to create and approve pull requests"
