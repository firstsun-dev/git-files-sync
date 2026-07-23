import { type ChangelogRelease } from '../types';

export const release: ChangelogRelease = {
    version: '1.3.0',
    entries: [
        {
            notable: true,
            text: {
                en: 'The plugin now speaks multiple languages — English, Traditional Chinese, and Simplified Chinese. It follows your Obsidian display language automatically, or you can pick one in Settings.',
                'zh-tw': '外掛現在支援多國語言——英文、繁體中文與簡體中文。會自動跟隨 Obsidian 的顯示語言，你也可以在設定中手動選擇。',
                'zh-cn': '插件现在支持多种语言——英文、繁体中文与简体中文。会自动跟随 Obsidian 的显示语言，你也可以在设置中手动选择。',
            },
        },
        {
            notable: true,
            text: {
                en: 'Checking sync status is now much faster, especially in vaults with lots of files.',
                'zh-tw': '檢查同步狀態的速度大幅提升，尤其是在檔案較多的 Vault 中。',
                'zh-cn': '检查同步状态的速度大幅提升，尤其是在文件较多的 Vault 中。',
            },
        },
        {
            text: {
                en: 'Fixed a bug where a linked (symlinked) folder could be pulled incorrectly instead of being treated as a link.',
                'zh-tw': '修復連結（符號連結）資料夾在拉取時可能被錯誤處理，而非視為連結的問題。',
                'zh-cn': '修复链接（符号链接）文件夹在拉取时可能被错误处理，而非视为链接的问题。',
            },
        },
        {
            text: {
                en: 'Added a setting to keep specific files or folders out of sync, in addition to what your repo\'s .gitignore already excludes.',
                'zh-tw': '新增設定，可在儲存庫 .gitignore 之外，額外排除特定檔案或資料夾不參與同步。',
                'zh-cn': '新增设置，可在仓库 .gitignore 之外，额外排除特定文件或文件夹不参与同步。',
            },
        },
        {
            text: {
                en: 'Settings now show your connection status at a glance, so you can tell right away if something needs attention.',
                'zh-tw': '設定頁面現在會一眼顯示連線狀態，讓你立即知道是否需要處理。',
                'zh-cn': '设置页面现在会一目了然地显示连接状态，让你立即知道是否需要处理。',
            },
        },
        {
            text: {
                en: 'The conflict resolution window can now be resized to see more content at once.',
                'zh-tw': '衝突解決視窗現在可以調整大小，方便一次看到更多內容。',
                'zh-cn': '冲突解决窗口现在可以调整大小，方便一次查看更多内容。',
            },
        },
        {
            text: {
                en: 'Picking your sync folders is easier now, with a folder browser instead of typing paths by hand.',
                'zh-tw': '選擇同步資料夾更方便了，改用資料夾瀏覽器取代手動輸入路徑。',
                'zh-cn': '选择同步文件夹更方便了，改用文件夹浏览器取代手动输入路径。',
            },
        },
        {
            text: {
                en: 'Connection errors now explain what went wrong in plain language instead of a raw technical error.',
                'zh-tw': '連線錯誤現在會以易懂的說明呈現，而不是顯示原始的技術錯誤訊息。',
                'zh-cn': '连接错误现在会以易懂的说明呈现，而不是显示原始的技术错误信息。',
            },
        },
        {
            text: {
                en: 'You\'ll now see a short "what\'s new" summary right after updating, so you don\'t miss new features.',
                'zh-tw': '更新後會立即看到簡短的「最新消息」摘要，讓你不錯過新功能。',
                'zh-cn': '更新后会立即看到简短的"最新消息"摘要，让你不错过新功能。',
            },
        },
    ],
};
