# Git File Sync 使用指南

[![CI](https://img.shields.io/github/actions/workflow/status/firstsun-dev/git-files-sync/ci.yml?branch=main&style=for-the-badge)](https://github.com/firstsun-dev/git-files-sync/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/firstsun-dev/git-files-sync?style=for-the-badge&color=2ea44f)](https://github.com/firstsun-dev/git-files-sync/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%22git-file-sync%22%5D.downloads&label=downloads&style=for-the-badge&color=007acc)](https://obsidian.md/plugins?id=git-file-sync)
[![License](https://img.shields.io/github/license/firstsun-dev/git-files-sync?style=for-the-badge)](LICENSE)

**[English](README.md)** · **[繁體中文](USAGE_zh.md)** · **[更新日志](CHANGELOG.md)**

Git File Sync 让你通过 GitHub、GitLab 或自建 Gitea，在桌面端与移动端 Obsidian 中**选择性同步文件**，不需要把整个 vault 都交给同一套同步服务。

你可以先检查变更、选择这次真正要同步的项目，再从“同步队列”一次确认并应用。插件直接通过 Git 服务 API 操作，不需要安装 Git CLI，也不需要在 vault 中创建本地 `.git` 仓库。

## 新版操作模型

Git File Sync 的版本控制流程可以记成：

**检查变更 → 加入同步队列 → 同步**

1. **检查“仓库变更”** — 在同一个界面查看本地变更、远程变更、重命名、删除和冲突。
2. **建立“同步队列”** — 勾选这次真正要处理的项目。
3. **检查并同步** — 在应用前先查看完整同步计划，再执行上传、下载和删除。

被选中的项目会从“仓库变更”移动到“同步队列”，同一条变更不会同时出现在两个区域。

## 主要功能

- **只同步你选择的文件** — 私人笔记或无关文件可以留在本地。
- **统一的版本控制界面** — 集中查看本地、远程、移动、删除与冲突状态。
- **一个同步队列** — 同一次操作可以包含上传、下载和远程删除。
- **应用前先检查** — 新增、修改、移动、下载和删除都会先出现在同步计划中。
- **内置差异对比** — 支持单栏与并排 Diff，对比本地与远程版本。
- **明确处理冲突** — 由你决定保留本地或远程，不会静默覆盖。
- **多平台与多服务** — 支持 GitHub、GitLab、Gitea，以及桌面端和移动端 Obsidian。
- **三种界面语言** — English、繁體中文、简体中文。

## 快速开始

1. 从 Obsidian 社区插件安装 Git File Sync。
2. 在 **设置 → Git File Sync** 中配置 GitHub、GitLab 或 Gitea。
3. 从侧边功能栏或命令面板打开 **版本控制（Source Control）**。
4. 检查 **仓库变更**。
5. 勾选要同步的项目，项目会移动到 **同步队列**。
6. 点击 **同步**，检查同步计划后选择 **应用**。

## 版本控制界面

### 仓库变更

显示当前需要处理、但尚未加入下一次同步的项目。可以使用搜索、筛选器与树状／列表视图快速缩小范围。

### 同步队列

显示下一次“同步”会实际处理的项目。每一项都会标示预计执行的动作：

- **上传** — 将本地版本应用到远程仓库。
- **下载** — 将远程版本带回当前 vault。
- **删除** — 将本地已删除的跟踪文件同步删除远程版本。

点击 **同步** 后会先生成一份合并的同步计划。远程的新增、修改、移动和删除会一起提交；下载则在确认后应用到本地。

### 文件状态

| 状态 | 含义 |
|---|---|
| `A` | 本地新增 |
| `M` | 本地已修改 |
| `D` | 本地已删除 |
| `R` | 已重命名或移动 |
| `↓` | 远程可下载 |
| `↕` | 远程已修改 |
| `!` | 冲突 |
| `S` | 已同步 |

> **本地已删除：** 将 `D` 项目加入同步队列后，默认会同步删除远程的跟踪文件。如果是误删，请改用 **下载**，把远程版本恢复到本地。

## 常见操作

| 情况 | 操作结果 |
|---|---|
| 本地新增文件 | `A` → 同步队列 → **上传** |
| 本地修改文件 | `M` → 同步队列 → **上传** |
| 文件只存在远程 | `↓` → 同步队列 → **下载** |
| 远程版本已修改 | `↕` → 同步队列 → **下载** |
| 本地删除跟踪文件 | `D` → 同步队列 → **删除**远程 |
| 本地误删 | `D` → **下载** → 恢复本地 |
| 重命名／移动 | `R` → 同步队列 → 以移动方式**上传** |
| 本地与远程都修改 | `!` → 检查冲突 → **保留本地**或**采用远程** |

## 差异对比与冲突

选择有变更的文件后，可以在同步前查看本地与远程内容差异。Diff 支持单栏与并排布局，并在可用时显示新增／删除行数。

![conflict](imgs/git-diff.png)
*同步前先检查本地与远程的差异，再决定保留哪一侧。*

如果本地与远程都修改过同一个文件，Git File Sync 会保留明确的冲突状态：

- **Keep Local／保留本地** — 使用本地内容覆盖远程。
- **Keep Remote／采用远程** — 接受远程版本并覆盖本地。

## 支持的 Git 服务

| 服务 | 适用场景 | 最低版本 |
|---|---|---|
| **GitHub** | github.com／GitHub Enterprise | — |
| **GitLab** | gitlab.com／自建 | GitLab 13.0+ |
| **Gitea** | 自建 Git 服务器 | Gitea 1.12+ |

## 初始设置

![Plugin Settings](imgs/plugin-settings.png)
*在设置面板选择 Git 服务并配置仓库。*

| 服务 | 必要信息 | 建议权限 |
|---|---|---|
| **GitHub** | Token、owner、repository | Fine-grained token：**Contents: Read and write** |
| **GitLab** | Token、project ID、base URL | `read_repository`、`write_repository` |
| **Gitea** | Token、owner、repository、base URL | Gitea 1.19+：`write:repository` |

其他设置包括语言、同步分支、仓库 Root Path、vault folder 范围、启动时刷新、忽略规则，以及 symbolic link 处理方式。Symbolic link 详细行为请参考 [Symbolic link handling](docs/symlink-handling.md)。

> **安全建议：** 令牌只授予必要仓库和最低权限，能设置到期时间就设置；不要把令牌写进可能被同步的笔记。如果怀疑泄露，请立即撤销并重新签发。

## 移动端

移动端使用相同的版本控制模型。同步队列默认保持紧凑，避免把“仓库变更”推离屏幕；选择文件后会进入适合手机操作的详情／Diff 界面。

跨设备工作时，建议先刷新远程状态再开始修改；完成后只把真正要同步的项目加入同步队列。

## 安装

### 从社区插件安装（推荐）

1. 打开 **设置 → 社区插件**，必要时关闭限制模式。
2. 点击 **浏览**，搜索 **Git File Sync**。
3. 点击 **安装**，完成后 **启用**。

### 手动安装

1. 从 [最新 Release](https://github.com/firstsun-dev/git-files-sync/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 创建 `<vault>/.obsidian/plugins/git-file-sync/`。
3. 将三个文件放入该目录。
4. 重新加载 Obsidian，并在 **设置 → 社区插件** 中启用 Git File Sync。

## 隐私与安全

- **Token 仅保存在本地** — 访问令牌保存在 vault 内的插件数据中，只会发送给你配置的 Git 服务。
- **无遥测** — 插件不收集使用分析或个人数据。
- **选择性同步** — 未选入同步流程的文件不会因为新版版本控制流程而自动上传。

## 系统要求

- Obsidian **1.11.0** 或更新版本
- 支持桌面端与移动端

## 更多文档

- [English README](README.md)
- [繁體中文使用指南](USAGE_zh.md)
- [Symbolic link handling](docs/symlink-handling.md)
- [完整更新日志](CHANGELOG.md)
- [Releases](https://github.com/firstsun-dev/git-files-sync/releases)
