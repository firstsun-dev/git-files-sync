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
		// Temporarily out of tsconfig scope pending the Phase 1 Shell/Git E2E
		// harness rewrite (test/real-provider-e2e) -- not part of the lint gate
		// until it's ported off the old Node harness.
		"e2e/**",
		"vitest.e2e.config.ts",
	]),
);
