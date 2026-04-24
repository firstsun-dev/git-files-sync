# 发布方式总览

本项目提供三种发布方式，根据你的需求选择：

## 🚀 方式一：Semantic Release（推荐）

**完全自动化，基于 commit message**

### 优点
- ✅ 完全自动化，无需手动操作
- ✅ 强制规范的 commit message
- ✅ 自动生成 CHANGELOG
- ✅ 版本号由代码变更决定，更合理
- ✅ 不会遗漏任何步骤

### 使用方法
```bash
# 1. 按规范提交代码
git commit -m "feat: add new feature"

# 2. 推送到主分支
git push origin main

# 3. 自动发布！
```

### Commit 规范
- `feat:` → 新功能 → MINOR 版本 (1.0.0 → 1.1.0)
- `fix:` → Bug 修复 → PATCH 版本 (1.0.0 → 1.0.1)
- `BREAKING CHANGE:` → 重大变更 → MAJOR 版本 (1.0.0 → 2.0.0)

### 配置文件
- `.releaserc.json` - Semantic Release 配置
- `.github/workflows/semantic-release.yml` - GitHub Actions workflow

### 详细文档
参见 [SEMANTIC_RELEASE.md](./SEMANTIC_RELEASE.md)

---

## 🎯 方式二：Auto Release

**手动触发，选择版本类型**

### 优点
- ✅ 可以手动控制发布时机
- ✅ 简单的版本选择（patch/minor/major）
- ✅ 自动更新所有文件

### 使用方法
1. 进入 GitHub → Actions → Auto Release
2. 点击 "Run workflow"
3. 选择版本类型：
   - **patch**: 1.0.0 → 1.0.1
   - **minor**: 1.0.0 → 1.1.0
   - **major**: 1.0.0 → 2.0.0
4. 点击 "Run workflow"

### 自动执行
- 运行测试
- 更新版本号（package.json, manifest.json, versions.json）
- 更新 CHANGELOG
- 创建 commit 和 tag
- 构建插件
- 创建 GitHub Release
- 上传文件

### 配置文件
- `.github/workflows/auto-release.yml`

---

## 📦 方式三：Manual Release

**完全手动控制**

### 优点
- ✅ 完全控制每个步骤
- ✅ 适合特殊情况

### 使用方法
```bash
# 1. 更新版本号
npm version patch  # 或 minor, major

# 2. 手动更新 manifest.json 和 versions.json

# 3. 更新 CHANGELOG.md

# 4. 提交更改
git add .
git commit -m "chore: bump version to 1.0.1"
git push

# 5. 创建并推送 tag
git tag 1.0.1
git push origin 1.0.1

# 6. GitHub Actions 自动创建 Release（草稿）

# 7. 手动编辑并发布 Release
```

### 配置文件
- `.github/workflows/release.yml`

---

## 📊 对比表

| 特性 | Semantic Release | Auto Release | Manual Release |
|------|-----------------|--------------|----------------|
| 自动化程度 | 🟢 完全自动 | 🟡 半自动 | 🔴 手动 |
| 版本决策 | 🟢 基于代码变更 | 🟡 手动选择 | 🟡 手动选择 |
| CHANGELOG | 🟢 自动生成 | 🟡 需要手动编辑 | 🔴 完全手动 |
| Commit 规范 | 🟢 强制规范 | 🔴 无要求 | 🔴 无要求 |
| 出错风险 | 🟢 低 | 🟡 中 | 🔴 高 |
| 学习成本 | 🟡 需要学习规范 | 🟢 简单 | 🟢 简单 |

---

## 🎯 推荐使用场景

### 使用 Semantic Release（推荐）
- ✅ 日常开发和发布
- ✅ 团队协作项目
- ✅ 需要规范的 commit history
- ✅ 希望完全自动化

### 使用 Auto Release
- ✅ 不想学习 commit 规范
- ✅ 需要手动控制发布时机
- ✅ 快速发布

### 使用 Manual Release
- ✅ 特殊情况需要完全控制
- ✅ 调试发布流程
- ✅ 紧急修复

---

## 🔧 配置

### 启用 Semantic Release

如果你选择使用 Semantic Release，建议禁用其他两个 workflow 以避免冲突：

```bash
# 重命名或删除其他 workflows
mv .github/workflows/auto-release.yml .github/workflows/auto-release.yml.disabled
mv .github/workflows/release.yml .github/workflows/release.yml.disabled
```

### 同时使用多个方式

如果你想保留多个选项：
- Semantic Release 用于日常自动发布
- Auto Release 用于紧急手动发布
- Manual Release 作为备用

---

## 📚 相关文档

- [SEMANTIC_RELEASE.md](./SEMANTIC_RELEASE.md) - Semantic Release 详细指南
- [RELEASE_GUIDE.md](./RELEASE_GUIDE.md) - 手动发布指南
- [WORKFLOWS.md](./WORKFLOWS.md) - GitHub Actions 说明
- [SUBMISSION.md](./SUBMISSION.md) - Obsidian 插件提交指南

---

## 🚀 快速开始

### 推荐：使用 Semantic Release

1. **学习 commit 规范**（5 分钟）
   - `feat:` 新功能
   - `fix:` Bug 修复
   - `docs:` 文档更新

2. **正常开发**
   ```bash
   git commit -m "feat: add new feature"
   git push origin main
   ```

3. **自动发布！**
   - 无需其他操作
   - 检查 GitHub Releases 查看结果

就这么简单！🎉
