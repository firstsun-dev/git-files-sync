import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts", "src/**/*.tsx"],
		...sonarjs.configs.recommended,
	},
	{
		// Retained scripts are local Node build/release tooling, not plugin code.
		files: ["scripts/**/*.mjs"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			"import/no-nodejs-modules": "off",
			"no-restricted-globals": "off",
		},
	},
	{
		// E2E harness glue runs under Node (vitest, `environment: 'node'`), not
		// Obsidian's Electron renderer — needs `process`, same as scripts/. Unlike
		// scripts/, it deliberately keeps fetch/globalThis/node:* built-ins out
		// (see docs/testing/real-provider-e2e.md), so it does NOT get the same
		// import/no-nodejs-modules / no-restricted-globals exemptions.
		files: ["e2e/**/*.ts", "vitest.e2e.config.ts"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		".claude/**",
		".agents/**",
		"coverage/**",
	]),
);
