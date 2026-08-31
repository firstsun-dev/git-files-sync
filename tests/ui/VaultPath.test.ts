import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataAdapter } from 'obsidian';
import { ensureParentDirs } from '../../src/utils/vault-path';

describe('ensureParentDirs helper', () => {
	let mockAdapter: Partial<DataAdapter>;

	beforeEach(() => {
		mockAdapter = {
			mkdir: vi.fn().mockResolvedValue(undefined),
		};
	});

	it('should create parent directories for a simple nested path', async () => {
		await ensureParentDirs(mockAdapter as DataAdapter, 'original/file.md');

		expect(mockAdapter.mkdir).toHaveBeenCalledWith('original');
		expect(mockAdapter.mkdir).toHaveBeenCalledTimes(1);
	});

	it('should create all nested parent directories', async () => {
		await ensureParentDirs(mockAdapter as DataAdapter, 'a/b/c/file.md');

		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(1, 'a');
		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(2, 'a/b');
		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(3, 'a/b/c');
		expect(mockAdapter.mkdir).toHaveBeenCalledTimes(3);
	});

	it('should not create directories for root-level files', async () => {
		await ensureParentDirs(mockAdapter as DataAdapter, 'file.md');

		expect(mockAdapter.mkdir).not.toHaveBeenCalled();
	});

	it('should handle mkdir failures gracefully (folder might already exist)', async () => {
		mockAdapter.mkdir = vi.fn()
			.mockRejectedValueOnce(new Error('Folder already exists'))
			.mockResolvedValueOnce(undefined);

		await ensureParentDirs(mockAdapter as DataAdapter, 'a/b/file.md');

		expect(mockAdapter.mkdir).toHaveBeenCalledTimes(2);
		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(1, 'a');
		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(2, 'a/b');
	});

	it('should handle complex nested paths', async () => {
		await ensureParentDirs(mockAdapter as DataAdapter, 'original/path/to/restored/file.md');

		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(1, 'original');
		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(2, 'original/path');
		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(3, 'original/path/to');
		expect(mockAdapter.mkdir).toHaveBeenNthCalledWith(4, 'original/path/to/restored');
		expect(mockAdapter.mkdir).toHaveBeenCalledTimes(4);
	});

	it('should safely handle when mkdir throws and then succeeds', async () => {
		const mkdirMock = vi.fn()
			.mockRejectedValueOnce(new Error('Permission denied'))
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined);
		mockAdapter.mkdir = mkdirMock;

		await ensureParentDirs(mockAdapter as DataAdapter, 'a/b/file.md');

		// Both directories should be attempted even if first fails
		expect(mkdirMock).toHaveBeenCalledTimes(2);
	});
});
