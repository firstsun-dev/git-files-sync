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
      include: ['src/logic/**/*.ts', 'src/services/**/*.ts', 'src/ui/source-control/**/*.ts', 'src/utils/**/*.ts'],
      exclude: ['src/main.ts', 'src/settings.ts', '**/.claude/**'],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 60,
      },
      reporter: ['text', 'json', 'html', 'lcov'],
    },
  },
});
