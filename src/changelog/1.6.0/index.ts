import { type ChangelogRelease } from '../types';

export const release: ChangelogRelease = {
    version: '1.6.0',

    headline: {
        en: 'A new Source Control workflow',
        'zh-tw': '全新的原始碼控制流程',
        'zh-cn': '全新的源代码控制流程',
    },
    summary: {
        en: 'Review repository changes, choose what belongs in the Sync Queue, then sync everything from one place.',
        'zh-tw': '先檢視儲存庫變更，選擇要放入同步佇列的項目，最後在同一處完成同步。',
        'zh-cn': '先查看仓库变更，选择要放入同步队列的项目，最后在同一处完成同步。',
    },

    onboarding: {
        action: 'open-source-control',
        steps: [
            {
                title: {
                    en: 'Review Repository Changes',
                    'zh-tw': '檢視儲存庫變更',
                    'zh-cn': '查看仓库变更',
                },
                description: {
                    en: 'See local edits, remote updates, renames, deletions, and conflicts in one place.',
                    'zh-tw': '在同一處查看本機編輯、遠端更新、重新命名、刪除與衝突。',
                    'zh-cn': '在同一处查看本地编辑、远程更新、重命名、删除与冲突。',
                },
            },
            {
                title: {
                    en: 'Build your Sync Queue',
                    'zh-tw': '建立同步佇列',
                    'zh-cn': '建立同步队列',
                },
                description: {
                    en: 'Select exactly which changes should be included in the next sync.',
                    'zh-tw': '精確選擇下一次同步要包含哪些變更。',
                    'zh-cn': '精确选择下一次同步要包含哪些变更。',
                },
            },
            {
                title: {
                    en: 'Review and Sync',
                    'zh-tw': '檢視並同步',
                    'zh-cn': '查看并同步',
                },
                description: {
                    en: 'Uploads, downloads, moves, and remote deletions are combined into one reviewed operation.',
                    'zh-tw': '上傳、下載、搬移與遠端刪除會合併成一次可檢視的操作。',
                    'zh-cn': '上传、下载、移动与远程删除会合并成一次可查看的操作。',
                },
            },
        ],
    },

    entries: [
        {
            notable: true,
            text: {
                en: '🔀 New Source Control workflow — Review, Queue, then Sync replaces the old select-and-push flow.',
                'zh-tw': '🔀 全新的原始碼控制流程 — 「檢視 → 佇列 → 同步」取代了舊有的選取後直接推送流程。',
                'zh-cn': '🔀 全新的源代码控制流程 — “查看 → 队列 → 同步”取代了原有的选取后直接推送流程。',
            },
        },
        {
            notable: true,
            text: {
                en: '📋 Unified Sync Queue — Uploads, downloads, and remote deletions are gathered into one queue and applied together.',
                'zh-tw': '📋 統一的同步佇列 — 上傳、下載與遠端刪除會集中到同一個佇列，並一併套用。',
                'zh-cn': '📋 统一的同步队列 — 上传、下载与远程删除会集中到同一个队列，并一并应用。',
            },
        },
        {
            notable: true,
            text: {
                en: '🗑️ Local deletions now behave predictably — Sync a locally deleted tracked file to remove it remotely, or use Download to restore it.',
                'zh-tw': '🗑️ 本機刪除行為更可預期 — 同步已在本機刪除的追蹤檔案會一併移除遠端；也可使用「下載」還原該檔案。',
                'zh-cn': '🗑️ 本地删除行为更可预期 — 同步已在本地删除的跟踪文件会一并移除远程；也可使用“下载”还原该文件。',
            },
        },
        {
            text: {
                en: '✨ Clear file status indicators and an improved desktop and mobile workflow.',
                'zh-tw': '✨ 更清楚的檔案狀態標示，桌面與行動裝置操作體驗也一併優化。',
                'zh-cn': '✨ 更清晰的文件状态标识，桌面与移动设备操作体验也一并优化。',
            },
        },
    ],
};
