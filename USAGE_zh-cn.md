# Git File Sync 使用指南

[![CI](https://img.shields.io/github/actions/workflow/status/firstsun-dev/git-files-sync/ci.yml?branch=main&style=for-the-badge)](https://github.com/firstsun-dev/git-files-sync/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/firstsun-dev/git-files-sync?style=for-the-badge&color=2ea44f)](https://github.com/firstsun-dev/git-files-sync/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%22git-file-sync%22%5D.downloads&label=downloads&style=for-the-badge&color=007acc)](https://obsidian.md/plugins?id=git-file-sync)
[![License](https://img.shields.io/github/license/firstsun-dev/git-files-sync?style=for-the-badge)](LICENSE)

**[English](README.md)** · **[繁體中文](USAGE_zh.md)** · **[更新日志](CHANGELOG.md)**

<video src="https://blog-assets.firstsun.org/obsidian/plugins/git-file-sync/git-file-sync-zh.webm" width="100%" controls autoplay loop muted playsinline></video>

本指南介绍如何使用 Git File Sync 插件，在移动设备与桌面端之间，通过 GitLab、GitHub 或自建 Gitea 选择性同步笔记。

Git File Sync 不会同步整个 vault；您可以只选择要分享、发布或备份的笔记，同时将私人笔记保留在本地。它直接连接 Git 服务的 API，不需要安装 Git、使用命令行，或在 vault 中创建本地 `.git` 仓库。

---

## 支持的 Git 服务

| 服务 | 适用场景 | 最低版本 |
| :--- | :--- | :--- |
| **GitHub** | 公开／私有仓库 | — |
| **GitLab** | gitlab.com 或自建实例 | GitLab 13.0+ |
| **Gitea** | 自建 Git 服务器 | Gitea 1.12+ |

---

## 1. 初始设置

在开始同步前，请完成以下设置：

![Plugin Settings](imgs/plugin-settings.png)
*在设置面板选择 Git 服务，并填写对应的凭据和路径。*

1. **选择服务**：在 `设置` > `Git File Sync` 中选择 GitLab、GitHub 或 Gitea。
2. **填写凭据**：

   > **安全提示：** 请把每个令牌的权限范围缩到最小：只允许需要同步的仓库、只授予必要权限，并设置较短的有效期。令牌只应保存在本插件的设置中，不要粘贴到会被同步的笔记里。如果令牌可能泄露，请立即撤销并重新创建；不再使用的令牌也应直接撤销。

   - **GitHub**：建议创建 [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)，而不是 classic token。在 **Repository access** 中选择 *Only select repositories*，只指定要同步的仓库；设置 **Expiration**（建议不超过 90 天），并只授予 **Contents: Read and write**。如果必须使用 classic token，则使用 `repo` scope，并为该用途设置到期时间。
   - **GitLab**：建议优先使用 [project access token](https://docs.gitlab.com/user/project/settings/project_access_tokens/)（`Project` > `Settings` > `Access tokens`），而不是个人访问令牌，使权限限制在单个项目内，也可以独立撤销。插件只会调用 repository tree、blob、commit 和 branch 相关 API，因此只需要 `read_repository` 和 `write_repository`，**不需要** `api`。如需推送到非 protected branch，最低角色为 **Developer**。请设置到期时间；服务器网址默认为 `https://gitlab.com`，自建环境请改为您的实例网址。
   - **Gitea**：在 `用户设置` > `应用程序` > `访问令牌` 中创建令牌。插件只会操作仓库内容、分支和 Git data；Gitea 1.19+ 支持 scoped token，请只选择 **`write:repository`**（已包含读取权限），不要选择全部权限。较旧版本（最低支持到 1.12）没有 scoped token，令牌默认是账号级别；这种情况下建议使用只拥有目标仓库权限的专用 bot / service account，而不是个人账号。若实例支持到期时间也请设置，并将服务器网址指向您的 Gitea 实例（例如 `https://gitea.example.com`）。

   三种服务都可以从各自的设置页面立即撤销令牌。如果令牌可能泄露，请先撤销，再签发新的令牌。
3. **仓库路径**：如需把笔记存放在仓库中的特定目录（例如 `notes/`），请设置 `Root Path`。
4. **语言和自动刷新**：可以选择跟随系统、English、繁體中文或简体中文。“Obsidian 启动时自动刷新同步状态”默认开启，也可在设置中关闭。

---

## 2. 核心操作流程

### 💡 检查同步状态

每次开始工作或切换设备时，建议先查看状态：

1. 点击侧边栏的**列表图标**，或打开命令面板 (`Ctrl/Cmd + P`) 并运行 `Open sync status view`。
2. 同步状态会在 Obsidian 启动后自动刷新；需要时仍可点击 **Refresh status**。
3. 使用状态标签、路径搜索或可选的树状视图浏览文件。树状视图支持展开文件夹和三态复选框，可一次选中整个文件夹。
4. 文件会显示为：
   - **Synced**：已同步（与远程一致）。
   - **Modified**：本地已修改（需要 Push）。
   - **Remote only**：远程有新文件（需要 Pull）。
   - **Moved**：文件或文件夹已重命名／移动，尚待同步；可以 Push 或撤销移动。

![sync-status](imgs/sync-status.png)
*同步状态面板让您一目了然地确认哪些文件已经修改，并进行上传或下载。*

### ⬆️ 如何上传（Push）

写完笔记后，您可以：

- **单个文件**：点击左侧功能栏的云上传图标，或在文件列表中右键选择 `Push to GitLab/GitHub/Gitea`。
- **批量上传**：在同步面板勾选多个文件，然后点击 **Push selected**。
- **确认计划**：每次 Push 前都会列出新增、修改、移动和删除项目；确认后点击 **Apply**。文件重命名或文件夹移动会作为真正的移动提交，不会在远程留下重复文件。

### ⬇️ 如何下载（Pull）

1. 打开同步面板并点击 **Refresh status**。
2. 找到标记为 **Remote only** 或 **Modified**（远程版本较新）的文件。
3. 勾选后点击 **Pull selected**。
4. 查看即将应用的同步计划，然后点击 **Apply**。
5. **注意**：Pull 会覆盖本地内容。如果两端都有修改，会自动打开冲突解决窗口。

---

## 3. 冲突解决（Conflict Resolution）

当同一文件在本地和远程都被修改时，会显示冲突窗口：

1. 左侧是**本地版本**，右侧是**远程版本**。
2. 查看两侧的差异。
3. 选择 **Keep Local**（保留本地版本）或 **Keep Remote**（采用远程版本）。
4. 选择后，插件会更新文件。

![conflict](imgs/git-diff.png)
*内置差异查看器可在同步前并排对比本地与远程的修改。*

在桌面端，点击 **Diff** 会在专用窗格打开对比；移动端仍在面板内显示。可以点击文件路径打开本地笔记，或在支持的服务上打开远程文件页面。

---

## 4. 移动设备使用技巧

- **打开面板**：从屏幕左侧向右滑动，展开功能栏后即可看到同步图标。
- **工作前先 Pull**：每次开始编辑前，先刷新状态以确认已获取最新版本。
- **完成后及时 Push**：编辑完成后及时 Push，确保变更已保存到远程。

---

## 🔒 隐私与安全

- 个人访问令牌只保存在本地 vault 的插件数据目录中，只会发送到您配置的 Git 服务。
- 插件不收集使用数据或分析信息。
