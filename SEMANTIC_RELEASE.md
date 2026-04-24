# Semantic Release 使用指南

本项目使用 [semantic-release](https://semantic-release.gitbook.io/) 自动管理版本号和发布。

## 工作原理

Semantic Release 根据 **commit message** 自动决定版本号：

- `feat:` → **MINOR** 版本 (1.0.0 → 1.1.0)
- `fix:` → **PATCH** 版本 (1.0.0 → 1.0.1)
- `BREAKING CHANGE:` → **MAJOR** 版本 (1.0.0 → 2.0.0)

## Commit Message 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| Type | 说明 | 版本影响 |
|------|------|---------|
| `feat` | 新功能 | MINOR |
| `fix` | Bug 修复 | PATCH |
| `perf` | 性能优化 | PATCH |
| `refactor` | 代码重构 | PATCH |
| `docs` | 文档更新 | 无 |
| `style` | 代码格式 | 无 |
| `test` | 测试相关 | 无 |
| `build` | 构建系统 | 无 |
| `ci` | CI 配置 | 无 |
| `chore` | 其他杂项 | 无 |

### 示例

**新功能 (MINOR):**
```bash
git commit -m "feat: add GitHub support"
git commit -m "feat(sync): add batch pull operation"
```

**Bug 修复 (PATCH):**
```bash
git commit -m "fix: resolve conflict detection issue"
git commit -m "fix(ui): correct button alignment"
```

**重大变更 (MAJOR):**
```bash
git commit -m "feat: redesign settings API

BREAKING CHANGE: settings structure has changed"
```

**不触发发布:**
```bash
git commit -m "docs: update README"
git commit -m "chore: update dependencies"
git commit -m "test: add unit tests"
```

## 自动发布流程

### 触发条件

当你推送到 `main` 或 `master` 分支时，semantic-release 会自动：

1. ✅ 分析所有 commit messages
2. ✅ 决定新版本号
3. ✅ 更新 package.json
4. ✅ 更新 manifest.json
5. ✅ 更新 versions.json
6. ✅ 生成 CHANGELOG.md
7. ✅ 创建 git commit 和 tag
8. ✅ 构建插件
9. ✅ 创建 GitHub Release
10. ✅ 上传 main.js, manifest.json, styles.css

### 使用步骤

1. **开发功能并提交**
   ```bash
   git add .
   git commit -m "feat: add new sync feature"
   ```

2. **推送到主分支**
   ```bash
   git push origin main
   ```

3. **自动发布**
   - GitHub Actions 自动运行
   - 检查 commit messages
   - 如果有 `feat` 或 `fix`，自动创建新版本
   - 自动发布到 GitHub Releases

## 配置文件

### .releaserc.json

```json
{
  "branches": ["main", "master"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/exec",
    "@semantic-release/git",
    "@semantic-release/github"
  ]
}
```

### GitHub Actions Workflow

`.github/workflows/semantic-release.yml` 会在推送到 main/master 时自动运行。

## 版本号示例

假设当前版本是 `1.0.0`：

| Commits | 新版本 |
|---------|--------|
| `fix: bug fix` | 1.0.1 |
| `feat: new feature` | 1.1.0 |
| `feat: feature with BREAKING CHANGE` | 2.0.0 |
| `fix: bug` + `feat: feature` | 1.1.0 |
| `docs: update` | 无发布 |

## 跳过发布

如果你不想触发发布，在 commit message 中添加 `[skip ci]`：

```bash
git commit -m "docs: update README [skip ci]"
```

## 手动触发发布

如果需要手动触发：

```bash
npm run semantic-release
```

## 查看发布历史

所有发布都会记录在：
- GitHub Releases: https://github.com/tianyao/git-file-push/releases
- CHANGELOG.md: 自动生成的变更日志

## 与其他 Workflows 的关系

现在项目有三个发布方式：

1. **semantic-release.yml** (推荐) - 自动根据 commit 发布
2. **auto-release.yml** - 手动触发，选择版本类型
3. **release.yml** - 手动创建 tag 触发

**推荐使用 semantic-release**，因为它：
- ✅ 完全自动化
- ✅ 强制规范的 commit message
- ✅ 自动生成 CHANGELOG
- ✅ 不会遗漏步骤

## 最佳实践

1. **每个 commit 只做一件事**
   ```bash
   # 好
   git commit -m "feat: add GitHub support"
   git commit -m "fix: resolve sync conflict"
   
   # 不好
   git commit -m "feat: add GitHub support and fix sync conflict"
   ```

2. **使用 scope 组织 commits**
   ```bash
   git commit -m "feat(sync): add batch operations"
   git commit -m "fix(ui): correct modal layout"
   git commit -m "docs(readme): update installation guide"
   ```

3. **重大变更要明确说明**
   ```bash
   git commit -m "feat: redesign API
   
   BREAKING CHANGE: The settings API has been completely redesigned.
   Old settings will need to be migrated manually."
   ```

4. **开发时使用 feature branch**
   ```bash
   git checkout -b feature/github-support
   # 开发...
   git commit -m "feat: add GitHub support"
   git push origin feature/github-support
   # 创建 PR 合并到 main
   ```

## 故障排除

### 没有触发发布

检查：
- Commit message 格式是否正确
- 是否推送到 main/master 分支
- GitHub Actions 是否有权限

### 版本号不符合预期

检查：
- Commit message 的 type 是否正确
- 是否有 BREAKING CHANGE

### 构建失败

检查：
- 测试是否通过 (`npm run test`)
- 构建是否成功 (`npm run build`)

## 参考资料

- [Semantic Release 文档](https://semantic-release.gitbook.io/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Commit Message 规范](https://www.conventionalcommits.org/zh-hans/)
