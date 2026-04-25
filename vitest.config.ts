import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    alias: {
      'obsidian': './tests/setup.ts'
    }
  },
});
