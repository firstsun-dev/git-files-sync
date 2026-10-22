import { type ChangelogRelease } from '../types';

export const release: ChangelogRelease = {
    version: '1.7.0',

    headline: {
        en: 'Automatic sync, on your schedule',
        'zh-tw': '依照你的時間自動同步',
        'zh-cn': '按照你的时间自动同步',
    },
    summary: {
        en: 'Automatically keep your vault and remote repository in sync on a configurable schedule, while leaving conflicts safely for manual resolution.',
        'zh-tw': '依照你設定的週期自動同步 Vault 與遠端儲存庫；遇到需要人工判斷的衝突時會安全略過，保留給你手動處理。',
        'zh-cn': '按照你设置的周期自动同步 Vault 与远程仓库；遇到需要人工判断的冲突时会安全跳过，保留给你手动处理。',
    },

    entries: [
        {
            notable: true,
            text: {
                en: '⏱️ Automatic sync — Apply the default Sync action for pending changes on a configurable interval.',
                'zh-tw': '⏱️ 自動同步 — 依照可設定的週期，自動套用待處理變更的預設同步動作。',
                'zh-cn': '⏱️ 自动同步 — 按照可设置的周期，自动应用待处理更改的默认同步动作。',
            },
        },
        {
            notable: true,
            text: {
                en: '🚀 Optional sync on startup — Run one automatic sync right after Obsidian finishes loading.',
                'zh-tw': '🚀 可選的啟動時同步 — 在 Obsidian 載入完成後立即執行一次自動同步。',
                'zh-cn': '🚀 可选的启动时同步 — 在 Obsidian 加载完成后立即执行一次自动同步。',
            },
        },
        {
            notable: true,
            text: {
                en: '🛡️ Conflicts are skipped safely — Files that need manual resolution are left untouched while unrelated changes keep syncing.',
                'zh-tw': '🛡️ 衝突會安全略過 — 需要手動處理的檔案會保持原狀，其餘變更則照常同步。',
                'zh-cn': '🛡️ 冲突会安全跳过 — 需要手动处理的文件会保持原样，其余更改则照常同步。',
            },
        },
    ],
};
