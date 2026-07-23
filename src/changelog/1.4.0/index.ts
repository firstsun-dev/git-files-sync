import { type ChangelogRelease } from '../types';

export const release: ChangelogRelease = {
    version: '1.4.0',
    entries: [
        {
            notable: true,
            text: {
                en: 'The sync panel now has a search box above the tabs — type part of a path to filter the list, and a folder prefix doubles as a folder filter.',
                'zh-tw': '同步面板現在多了搜尋框，位置在分頁上方——輸入路徑的一部分即可篩選清單，輸入資料夾前綴也能當作資料夾篩選。',
                'zh-cn': '同步面板现在多了搜索框，位置在分页上方——输入路径的一部分即可筛选列表，输入文件夹前缀也能当作文件夹筛选。',
            },
        },
        {
            notable: true,
            text: {
                en: 'File paths in the sync panel are now clickable — local files open in your vault, and remote-only files open the page on GitHub.',
                'zh-tw': '同步面板中的檔案路徑現在可以點擊——本機檔案會在 Vault 中開啟，僅存在遠端的檔案則會開啟其 GitHub 頁面。',
                'zh-cn': '同步面板中的文件路径现在可以点击——本机文件会在 Vault 中打开，仅存在远端的文件则会打开其 GitHub 页面。',
            },
        },
        {
            text: {
                en: 'On desktop, the Diff button now opens the comparison in its own pane instead of expanding inline, so it stays open alongside the rest of your vault.',
                'zh-tw': '在桌面版中，「差異」按鈕現在會在獨立面板中開啟比較結果，而非直接內嵌展開，讓它可以與 Vault 其他內容並排顯示。',
                'zh-cn': '在桌面版中，"差异"按钮现在会在独立面板中打开比较结果，而非直接内嵌展开，让它可以与 Vault 其他内容并排显示。',
            },
        },
        {
            text: {
                en: 'Fixed a rare case where a push could reuse a stale cached file list right after a commit, because GitHub briefly served a cached response for the branch head.',
                'zh-tw': '修復極少數情況下，推送後可能因 GitHub 暫時回傳快取的分支 HEAD 回應，而沿用過期的檔案清單快取。',
                'zh-cn': '修复极少数情况下，推送后可能因 GitHub 暂时返回缓存的分支 HEAD 响应，而沿用过期的文件列表缓存。',
            },
        },
    ],
};
