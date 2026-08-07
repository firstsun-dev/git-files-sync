# Git File Sync 使用說明書

[![CI](https://img.shields.io/github/actions/workflow/status/firstsun-dev/git-files-sync/ci.yml?branch=main&style=for-the-badge)](https://github.com/firstsun-dev/git-files-sync/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/firstsun-dev/git-files-sync?style=for-the-badge&color=2ea44f)](https://github.com/firstsun-dev/git-files-sync/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%22git-file-sync%22%5D.downloads&label=downloads&style=for-the-badge&color=007acc)](https://obsidian.md/plugins?id=git-file-sync)
[![License](https://img.shields.io/github/license/firstsun-dev/git-files-sync?style=for-the-badge)](LICENSE)

<video src="https://blog-assets.firstsun.org/obsidian/plugins/git-file-sync/git-file-sync-zh.webm" width="100%" controls autoplay loop muted playsinline></video>

本指南將引導您如何使用 Git File Sync 外掛，在行動裝置與桌面電腦之間，透過 GitLab、GitHub 或自架的 Gitea 選擇性同步筆記。

**[English](README.md)** · **[简体中文](USAGE_zh-cn.md)** · **[版本紀錄](CHANGELOG.md)**

---

## 支援的 Git 服務

<img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" height="28"> &nbsp;
<img src="https://img.shields.io/badge/GitLab-FC6D26?style=for-the-badge&logo=gitlab&logoColor=white" alt="GitLab" height="28"> &nbsp;
<img src="https://img.shields.io/badge/Gitea-609926?style=for-the-badge&logo=gitea&logoColor=white" alt="Gitea" height="28">

| | 服務 | 適用情境 | 最低版本 |
| :---: | :--- | :--- | :--- |
| <img src="https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub"> | **GitHub** | 公開 / 私人儲存庫 | — |
| <img src="https://img.shields.io/badge/GitLab-FC6D26?style=flat-square&logo=gitlab&logoColor=white" alt="GitLab"> | **GitLab** | gitlab.com 或自架 | GitLab 13.0+ |
| <img src="https://img.shields.io/badge/Gitea-609926?style=flat-square&logo=gitea&logoColor=white" alt="Gitea"> | **Gitea** | 自架 Git 伺服器 | Gitea 1.12+ |

---

## 1. 初始設定

在開始同步之前，請確保您已完成以下設定：

![Plugin Settings](imgs/plugin-settings.png)
*在設定面板選擇您的 Git 服務並填入對應的憑證與路徑。*

1. **選擇服務**：在 `設定` > `Git File Sync` 中選擇 GitLab、GitHub 或 Gitea。
2. **填寫憑證**：

   > **安全性提示：** 請將每個權杖的範圍縮到最小：只允許需要同步的儲存庫、只授予必要權限，並設定較短的有效期限。權杖只應儲存在此外掛的設定中，不要貼到會被同步的筆記。如果權杖可能外洩，請立即撤銷並重新建立；不再使用的權杖也應直接撤銷。

   - **GitHub**：建議建立 [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)，而不是 classic token。在 **Repository access** 選擇 *Only select repositories*，只指定要同步的儲存庫；設定 **Expiration**（建議 90 天以內），並只授予 **Contents: Read and write**。若必須使用 classic token，則使用 `repo` scope，並為此用途設定到期日。
   - **GitLab**：建議優先使用 [project access token](https://docs.gitlab.com/user/project/settings/project_access_tokens/)（`Project` > `Settings` > `Access tokens`），而不是個人存取權杖，讓權限限制在單一專案，也能獨立撤銷。外掛只會呼叫 repository tree、blob、commit 與 branch 相關 API，因此只需要 `read_repository` 與 `write_repository`，**不需要** `api`。若要推送到非 protected branch，最低角色需為 **Developer**。請設定到期日；伺服器網址預設為 `https://gitlab.com`，自架環境請改成您的實例網址。
   - **Gitea**：在 `使用者設定` > `應用程式` > `存取權杖` 建立權杖。外掛只會操作儲存庫內容、分支與 Git data；Gitea 1.19+ 支援 scoped token，請只選 **`write:repository`**（已包含讀取權限），不要選擇全部權限。較舊版本（最低支援至 1.12）沒有 scoped token，權杖預設為帳號層級；這種情況建議使用只具備目標儲存庫權限的專用 bot / service account，而不是個人帳號。若實例支援到期日也請設定，並將伺服器網址指向您的 Gitea 實例（例如 `https://gitea.example.com`）。

   三種服務都可以從各自的設定頁立即撤銷權杖。如果權杖可能外洩，請先撤銷，再簽發新的權杖。
3. **儲存庫路徑**：如果您想將筆記存放在儲存庫的特定資料夾（例如 `notes/`），請在 `Root Path` 中設定。
4. **語言與自動重新整理**：可選擇跟隨系統、English、繁體中文或简体中文；「Obsidian 啟動時自動重新整理同步狀態」預設開啟，亦可在設定中關閉。

---

## 2. 核心操作流程

### 💡 檢查同步狀態
每次開始工作或切換裝置時，建議先檢查狀態：
1. 點擊側邊欄的 **清單圖示** 或使用指令面板 (`Ctrl/Cmd + P`) 輸入 `Open sync status view`。
2. 同步狀態會在 Obsidian 啟動後自動重新整理；需要時仍可點擊 **Refresh status**。
3. 使用狀態分頁、路徑搜尋，或選擇性的樹狀檢視來瀏覽檔案。樹狀檢視支援展開資料夾與三態勾選框，可一次選取整個資料夾。
4. 您會看到檔案清單，標示為：
   - **Synced**：已同步（與雲端一致）。
   - **Modified**：本機已修改（需要 Push）。
   - **Remote only**：雲端有新檔案（需要 Pull）。
   - **Moved**：檔案或資料夾已重新命名／移動，尚待同步；可 Push 或還原移動。

![sync-status](imgs/sync-status.png)
*同步狀態面板讓您可以一目了然地確認哪些檔案已經修改，並進行上傳或下載。*

---

### ⬆️ 如何上傳（Push）
當您寫完筆記，想備份到雲端時：
- **單一檔案**：
  - 點擊左側功能列的 **雲端上傳圖示**。
  - 或者在檔案列表點擊右鍵，選擇 `Push to GitLab/GitHub/Gitea`。
- **批量上傳**：
  - 在同步面板勾選多個檔案，點擊下方的 **Push selected**。
- **確認計畫**：每次 Push 前會先列出新增、修改、移動與刪除項目；確認後點擊 **Apply**。重新命名檔案或移動資料夾會作為真正的移動同步，不會在遠端留下重複檔案。

---

### ⬇️ 如何下載（Pull）
當您在另一台裝置更新了筆記，想同步回目前裝置時：
1. 打開同步面板，點擊 **Refresh status**。
2. 找到顯示為 **Remote only** 或 **Modified**（雲端版本較新）的檔案。
3. 勾選後點擊 **Pull selected**。
4. 先確認即將套用的同步計畫，再點擊 **Apply**。
5. **注意**：Pull 會覆蓋掉您本機的內容。如果有衝突，會自動開啟衝突解決視窗。

---

## 3. 衝突處理 (Conflict Resolution)

如果同一個檔案在本機和雲端都被修改過，同步時會跳出衝突視窗：
1. 左側為 **本機版本**，右側為 **雲端版本**。
2. 您可以查看差異處。
3. 選擇 **Keep Local**（保留本機）或 **Keep Remote**（採用雲端版本）。
4. 選擇後系統會自動更新檔案。

![conflict](imgs/git-diff.png)
*內建的差異比對工具 (Diff Viewer) 可讓您在同步前並排比對本機與雲端的修改差異。*

在桌面版，點擊 **Diff** 會在專屬窗格開啟比對；行動版則維持面板內的比對。可點擊檔案路徑開啟本機筆記，或在支援的服務上開啟遠端檔案頁面。

---

## 4. 行動裝置使用技巧

- **開啟面板**：從螢幕左側向右滑動，展開功能列即可看到同步圖示。
- **工作前先 Pull**：建議每次開始寫筆記前，先點一下 Refresh 確保讀取到最新版本。
- **完成後即 Push**：寫完後隨手 Push，確保您的變更已儲存至雲端。

---

## 🔒 隱私與安全

- 您的存取權杖 (Token) 僅會儲存在本機 vault 的外掛資料目錄中，只會傳送到您設定的 Git 服務。
- 本外掛不會收集任何個人資料或使用紀錄。
