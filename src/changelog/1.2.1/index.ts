import { type ChangelogRelease } from '../types';

export const release: ChangelogRelease = {
    version: '1.2.1',
    entries: [
        {
            notable: true,
            text: {
                en: 'Fixed compatibility with Obsidian versions back to 1.11.0',
                'zh-tw': '修復與 Obsidian 1.11.0 以上版本的相容性問題',
                'zh-cn': '修复与 Obsidian 1.11.0 及以上版本的兼容性问题',
            },
        },
    ],
};
