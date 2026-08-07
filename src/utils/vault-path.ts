import { DataAdapter } from 'obsidian';

export async function ensureParentDirs(adapter: DataAdapter, filePath: string): Promise<void> {
	const parts = filePath.split('/');
	let cur = '';
	for (let i = 0; i < parts.length - 1; i++) {
		cur += (i > 0 ? '/' : '') + parts[i];
		try {
			await adapter.mkdir(cur);
		} catch {
			// already exists or failed
		}
	}
}
