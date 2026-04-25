import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    alias: {
      'obsidian': './tests/setup.ts'
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/ui/**', 'src/main.ts', 'src/settings.ts', '**/.claude/**'],
      reporter: ['text', 'json', 'html', 'lcov'],
    },
  },
});
