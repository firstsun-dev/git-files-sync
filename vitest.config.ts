import { defineConfig } from 'vitest/config';
// eslint-disable-next-line import/no-nodejs-modules
import * as path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    alias: {
      // eslint-disable-next-line no-undef
      'obsidian': path.resolve(process.cwd(), './tests/setup.ts')
    }
  },
});
