import { type ChangelogRelease } from '../types';

export const release: ChangelogRelease = {
    version: '1.3.1',
    entries: [
        {
            notable: true,
            text: {
                en: 'Pushing to GitHub is now noticeably faster — pushes route through GitHub\'s GraphQL API instead of one REST call per file, and a redundant lookup before each push has been removed.',
                'zh-tw': '推送到 GitHub 的速度明顯提升——推送改走 GitHub 的 GraphQL API，不再是每個檔案各一次 REST 請求，並移除了推送前的多餘查詢。',
                'zh-cn': '推送到 GitHub 的速度明显提升——推送改走 GitHub 的 GraphQL API，不再是每个文件各一次 REST 请求，并移除了推送前的冗余查询。',
            },
        },
    ],
};
