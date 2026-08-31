# Git File Sync 使用指南

[![CI](https://img.shields.io/github/actions/workflow/status/firstsun-dev/git-files-sync/ci.yml?branch=main&style=for-the-badge)](https://github.com/firstsun-dev/git-files-sync/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/firstsun-dev/git-files-sync?style=for-the-badge&color=2ea44f)](https://github.com/firstsun-dev/git-files-sync/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%22git-file-sync%22%5D.downloads&label=downloads&style=for-the-badge&color=007acc)](https://obsidian.md/plugins?id=git-file-sync)
[![License](https://img.shields.io/github/license/firstsun-dev/git-files-sync?style=for-the-badge)](LICENSE)

**[English](README.md)** · **[简体中文](USAGE_zh-cn.md)** · **[版本紀錄](CHANGELOG.md)**

Git File Sync 讓你透過 GitHub、GitLab 或自架 Gitea，在桌面版與行動版 Obsidian 中**選擇性同步檔案**，不需要把整個 vault 都交給同一套同步服務。

你可以先檢查變更、選擇這次真正要同步的項目，再從「同步佇列」一次確認與套用。外掛直接透過 Git 服務 API 操作，不需要安裝 Git CLI，也不需要在 vault 中建立本機 `.git` 儲存庫。

## 新版操作模型

Git File Sync 的版本控制流程可以記成：

**檢查變更 → 加入同步佇列 → 同步**

1. **檢查「儲存庫變更」** — 在同一個畫面查看本機變更、遠端變更、重新命名、刪除與衝突。
2. **建立「同步佇列」** — 勾選這次真正要處理的項目。
3. **檢查並同步** — 在套用前先查看完整同步計畫，再執行上傳、下載與刪除。

被選取的項目會從「儲存庫變更」移到「同步佇列」，同一筆變更不會同時出現在兩個區域。

## 主要功能

- **只同步你選擇的檔案** — 私人筆記或無關檔案可以留在本機。
- **統一的版本控制畫面** — 集中查看本機、遠端、移動、刪除與衝突狀態。
- **一個同步佇列** — 同一次操作可以包含上傳、下載與遠端刪除。
- **套用前先檢查** — 新增、修改、移動、下載與刪除都會先出現在同步計畫中。
- **內建差異比對** — 支援單欄與並排 Diff，比對本機與遠端版本。
- **明確處理衝突** — 由你決定保留本機或遠端，不會靜默覆蓋。
- **多平台與多服務** — 支援 GitHub、GitLab、Gitea，以及桌面版與行動版 Obsidian。
- **三種介面語言** — English、繁體中文、简体中文。

## 快速開始

1. 從 Obsidian 社群外掛安裝 Git File Sync。
2. 在 **設定 → Git File Sync** 中設定 GitHub、GitLab 或 Gitea。
3. 從側邊功能列或指令面板開啟 **版本控制（Source Control）**。
4. 檢查 **儲存庫變更**。
5. 勾選要同步的項目，項目會移到 **同步佇列**。
6. 點擊 **同步**，檢查同步計畫後按 **套用**。

## 版本控制畫面

### 儲存庫變更

顯示目前需要處理、但尚未加入下一次同步的項目。可以使用搜尋、篩選器與樹狀／清單檢視快速縮小範圍。

### 同步佇列

顯示下一次「同步」會實際處理的項目。每一筆都會標示預計執行的動作：

- **上傳** — 將本機版本套用到遠端儲存庫。
- **下載** — 將遠端版本帶回目前 vault。
- **刪除** — 將本機已刪除的追蹤檔案同步刪除遠端版本。

按下 **同步** 後會先產生一份合併的同步計畫。遠端的新增、修改、移動與刪除會一起提交；下載則在確認後套用到本機。

### 檔案狀態

| 狀態 | 意義 |
|---|---|
| `A` | 本機新增 |
| `M` | 本機已修改 |
| `D` | 本機已刪除 |
| `R` | 已重新命名或移動 |
| `↓` | 遠端可下載 |
| `↕` | 遠端已修改 |
| `!` | 衝突 |
| `S` | 已同步 |

> **本機已刪除：** 將 `D` 項目加入同步佇列後，預設會同步刪除遠端的追蹤檔案。如果你是誤刪，請改用 **下載**，將遠端版本還原回本機。

## 常見操作

| 情況 | 操作結果 |
|---|---|
| 本機新增檔案 | `A` → 同步佇列 → **上傳** |
| 本機修改檔案 | `M` → 同步佇列 → **上傳** |
| 檔案只存在遠端 | `↓` → 同步佇列 → **下載** |
| 遠端版本已修改 | `↕` → 同步佇列 → **下載** |
| 本機刪除追蹤檔案 | `D` → 同步佇列 → **刪除**遠端 |
| 本機誤刪 | `D` → **下載** → 還原本機 |
| 重新命名／移動 | `R` → 同步佇列 → 以移動方式**上傳** |
| 本機與遠端都修改 | `!` → 檢查衝突 → **保留本機**或**採用遠端** |

## 差異比對與衝突

選擇有變更的檔案後，可以在同步前查看本機與遠端內容差異。Diff 支援單欄與並排版面，並在可用時顯示新增／刪除行數。

![conflict](imgs/git-diff.png)
*同步前先檢查本機與遠端的差異，再決定要保留哪一側。*

如果本機與遠端都修改過同一個檔案，Git File Sync 會保留明確的衝突狀態：

- **Keep Local／保留本機** — 使用本機內容覆蓋遠端。
- **Keep Remote／採用遠端** — 接受遠端版本並覆蓋本機。

## 支援的 Git 服務

| 服務 | 適用情境 | 最低版本 |
|---|---|---|
| **GitHub** | github.com／GitHub Enterprise | — |
| **GitLab** | gitlab.com／自架 | GitLab 13.0+ |
| **Gitea** | 自架 Git 伺服器 | Gitea 1.12+ |

## 初始設定

![Plugin Settings](imgs/plugin-settings.png)
*在設定面板選擇 Git 服務並設定儲存庫。*

| 服務 | 必要資訊 | 建議權限 |
|---|---|---|
| **GitHub** | Token、owner、repository | Fine-grained token：**Contents: Read and write** |
| **GitLab** | Token、project ID、base URL | `read_repository`、`write_repository` |
| **Gitea** | Token、owner、repository、base URL | Gitea 1.19+：`write:repository` |

其他設定包含語言、同步分支、儲存庫 Root Path、vault folder 範圍、啟動時重新整理、忽略規則，以及 symbolic link 處理方式。Symbolic link 詳細行為請參考 [Symbolic link handling](docs/symlink-handling.md)。

> **安全性建議：** 權杖只授予必要的儲存庫與最低權限，能設定到期日就設定；不要把權杖寫進可能被同步的筆記。若懷疑外洩，立即撤銷並重新簽發。

## 行動裝置

行動版使用相同的版本控制模型。同步佇列預設保持精簡，避免把「儲存庫變更」推離畫面；選擇檔案後則進入適合手機操作的詳細／Diff 畫面。

跨裝置工作時，建議先重新整理遠端狀態，再開始修改；完成後只把真正要同步的項目加入同步佇列。

## 安裝

### 從社群外掛安裝（建議）

1. 打開 **設定 → 社群外掛**，必要時關閉限制模式。
2. 點擊 **瀏覽**，搜尋 **Git File Sync**。
3. 點擊 **安裝**，完成後 **啟用**。

### 手動安裝

1. 從 [最新 Release](https://github.com/firstsun-dev/git-files-sync/releases/latest) 下載 `main.js`、`manifest.json`、`styles.css`。
2. 建立 `<vault>/.obsidian/plugins/git-file-sync/`。
3. 將三個檔案放入該目錄。
4. 重新載入 Obsidian，並在 **設定 → 社群外掛** 啟用 Git File Sync。

## 隱私與安全

- **Token 僅存本機** — 存取權杖儲存在 vault 內的外掛資料中，只會傳送給你設定的 Git 服務。
- **無遙測** — 外掛不收集使用分析或個人資料。
- **選擇性同步** — 未選入同步流程的檔案不會因新版版本控制流程而自動上傳。

## 系統需求

- Obsidian **1.11.0** 或更新版本
- 支援桌面版與行動版

## 更多文件

- [English README](README.md)
- [简体中文使用指南](USAGE_zh-cn.md)
- [Symbolic link handling](docs/symlink-handling.md)
- [完整版本紀錄](CHANGELOG.md)
- [Releases](https://github.com/firstsun-dev/git-files-sync/releases)
