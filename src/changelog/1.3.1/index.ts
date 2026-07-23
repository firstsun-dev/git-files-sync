import { type ChangelogRelease } from '../types';

export const release: ChangelogRelease = {
    version: '1.3.1',
    entries: [
        {
            notable: true,
            text: {
                en: 'Pushing files is now noticeably faster — redundant lookups before each push have been eliminated.',
                'zh-tw': '推送檔案的速度明顯提升——推送前的多餘查詢已被移除。',
                'zh-cn': '推送文件的速度明显提升——推送前的冗余查询已被移除。',
            },
        },
    ],
};
