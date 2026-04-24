# 发布新版本指南

本项目提供两种发布方式：

## 方式一：自动版本管理（推荐）

使用 GitHub Actions 自动更新版本号并发布。

### 步骤：

1. 进入 GitHub 仓库
2. 点击 **Actions** 标签
3. 选择 **Auto Release** workflow
4. 点击 **Run workflow** 按钮
5. 选择版本类型：
   - **patch**: 修复 bug (1.0.0 → 1.0.1)
   - **minor**: 新功能 (1.0.0 → 1.1.0)
   - **major**: 重大变更 (1.0.0 → 2.0.0)
6. 点击 **Run workflow**

### 自动执行的操作：

✅ 运行测试  
✅ 更新 package.json 版本号  
✅ 更新 manifest.json 版本号  
✅ 更新 versions.json  
✅ 更新 CHANGELOG.md  
✅ 提交并推送更改  
✅ 创建 git tag  
✅ 创建 GitHub Release  
✅ 上传 main.js, manifest.json, styles.css  

### 优点：

- 一键完成所有操作
- 不会遗漏任何步骤
- 版本号自动同步
- 减少人为错误

---

## 方式二：手动发布

适合需要更多控制的情况。

### 步骤：

1. **更新版本号**
   ```bash
   # 修复 bug
   npm version patch
   
   # 新功能
   npm version minor
   
   # 重大变更
   npm version major
   ```

2. **手动更新 manifest.json**
   ```bash
   # 编辑 manifest.json，更新 version 字段
   ```

3. **手动更新 versions.json**
   ```json
   {
     "1.0.0": "0.15.0",
     "1.0.1": "0.15.0"  // 添加新版本
   }
   ```

4. **更新 CHANGELOG.md**
   ```markdown
   ## [1.0.1] - 2026-04-24
   
   ### Fixed
   - Bug fix description
   ```

5. **提交更改**
   ```bash
   git add .
   git commit -m "chore: bump version to 1.0.1"
   git push
   ```

6. **创建并推送 tag**
   ```bash
   git tag 1.0.1
   git push origin 1.0.1
   ```

7. **GitHub Actions 自动创建 Release**
   - release.yml workflow 会自动触发
   - 构建插件
   - 创建 GitHub Release（草稿）
   - 上传文件

8. **编辑 Release**
   - 进入 GitHub Releases
   - 编辑草稿 release
   - 添加发布说明
   - 发布

---

## 版本号规范

遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

- **MAJOR (x.0.0)**: 不兼容的 API 变更
- **MINOR (0.x.0)**: 向后兼容的新功能
- **PATCH (0.0.x)**: 向后兼容的 bug 修复

### 示例：

- `1.0.0` → `1.0.1`: 修复了一个 bug
- `1.0.1` → `1.1.0`: 添加了新功能
- `1.1.0` → `2.0.0`: 重大变更，可能不兼容旧版本

---

## 发布检查清单

在发布前确认：

- [ ] 所有测试通过 (`npm run test`)
- [ ] 构建成功 (`npm run build`)
- [ ] Lint 检查通过 (`npm run lint`)
- [ ] 在 Obsidian 中测试过
- [ ] 更新了 CHANGELOG.md
- [ ] README.md 是最新的

---

## 故障排除

### Workflow 失败

**测试失败：**
```bash
npm run test
```
修复失败的测试后重试。

**构建失败：**
```bash
npm run build
```
确保本地构建成功。

**权限错误：**
- 检查仓库设置 → Actions → General → Workflow permissions
- 选择 "Read and write permissions"

### Tag 已存在

```bash
# 删除本地 tag
git tag -d 1.0.1

# 删除远程 tag
git push origin :refs/tags/1.0.1

# 重新创建
git tag 1.0.1
git push origin 1.0.1
```

---

## 首次发布到 Obsidian 社区

完成首次 release 后：

1. Fork [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
2. 编辑 `community-plugins.json`，添加：
   ```json
   {
     "id": "git-file-push",
     "name": "Git File Push",
     "author": "tianyao",
     "description": "Sync individual notes with GitLab or GitHub. Push, pull, and track changes across mobile and desktop with visual diff and conflict resolution.",
     "repo": "tianyao/git-file-push"
   }
   ```
3. 创建 Pull Request
4. 等待 Obsidian 团队审核

详见 [SUBMISSION.md](./SUBMISSION.md)
