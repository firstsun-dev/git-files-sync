import { type ChangelogRelease } from '../types';

export const release: ChangelogRelease = {
    version: '1.5.0',
    entries: [
        {
            notable: true,
            text: {
                en: '🔎 Preview changes before syncing — Before pushing, pulling, or deleting remote files, review all planned additions, modifications, deletions, and moves before applying them.',
                'zh-tw': '🔎 同步前先預覽變更 — 推送、拉取或刪除遠端檔案前，現在會先顯示預計新增、修改、刪除與搬移的內容，確認後才會套用。',
                'zh-cn': '🔎 同步前先预览变更 — 推送、拉取或删除远程文件前，现在会先显示预计新增、修改、删除与移动的内容，确认后才会应用。',
            },
        },
        {
            notable: true,
            text: {
                en: '📦 Renames and moves now sync as real moves — Rename a file or move a folder without leaving duplicate files behind remotely. Folder moves are grouped together for easier review.',
                'zh-tw': '📦 重新命名與搬移會真正同步為搬移 — 重新命名檔案或搬移資料夾後，遠端會一併移除舊路徑，不再留下重複檔案。資料夾搬移也會合併顯示，讓清單更容易閱讀。',
                'zh-cn': '📦 重命名与移动会真正同步为移动 — 重命名文件或移动文件夹后，远程会一并移除旧路径，不再留下重复文件。文件夹移动也会合并显示，让列表更易于阅读。',
            },
        },
        {
            notable: true,
            text: {
                en: '🌳 Browse sync status in a tree — Expand and collapse your sync list by folder, select whole folders at once, and choose whether synced files appear in All.',
                'zh-tw': '🌳 以樹狀檢視瀏覽同步狀態 — 同步清單現在可依資料夾階層展開與收合，並可直接勾選整個資料夾中的檔案；也能選擇是否在「全部」中顯示已同步項目。',
                'zh-cn': '🌳 以树状视图浏览同步状态 — 同步列表现在可按文件夹层级展开与收起，并可直接勾选整个文件夹中的文件；也能选择是否在“全部”中显示已同步项目。',
            },
        },
        {
            text: {
                en: '⚡ Live sync status updates — File status updates immediately when you edit, rename, or move a file in your vault.',
                'zh-tw': '⚡ 同步狀態即時更新 — 編輯、重新命名或搬移 Vault 中的檔案時，同步狀態會立即更新，不必手動重新整理。',
                'zh-cn': '⚡ 同步状态即时更新 — 编辑、重命名或移动 Vault 中的文件时，同步状态会立即更新，不必手动刷新。',
            },
        },
        {
            text: {
                en: '🚀 Refresh status automatically at startup — The sync status refreshes automatically after Obsidian opens. This is on by default and can be turned off in Settings.',
                'zh-tw': '🚀 啟動時自動檢查同步狀態 — 開啟 Obsidian 後會自動更新同步狀態；此功能預設開啟，也可在設定中關閉。',
                'zh-cn': '🚀 启动时自动检查同步状态 — 打开 Obsidian 后会自动更新同步状态；此功能默认开启，也可在设置中关闭。',
            },
        },
        {
            text: {
                en: '✨ Interface refinements — Mobile status filters now use a dropdown; synced items are listed last so changes needing attention are easier to find.',
                'zh-tw': '✨ 操作介面優化 — 行動裝置上的狀態分類改為下拉選單，切換與瀏覽更順手；「已同步」項目也會排在清單最後，讓需要處理的變更更容易被看見。',
                'zh-cn': '✨ 操作界面优化 — 移动设备上的状态分类改为下拉菜单，切换与浏览更顺手；“已同步”项目也会排在列表最后，让需要处理的变更更容易被看见。',
            },
        },
    ],
};
