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
						'eslint.config.mts',
						'manifest.json',
						'scripts/typecheck-compat.mjs'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Architecture regression guard: the legacy sync-status presentation
		// layer was removed when Source Control became the single view (PR
		// #129). `SyncStatusService`/`SyncStatusRefreshService` (domain state)
		// remain, but nothing may import the deleted `ui/sync-status` modules
		// or resurrect them — the directory no longer exists on disk, and this
		// rule keeps any future file of the same name from being re-wired in.
		files: ["src/**/*.ts", "src/**/*.tsx"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["**/ui/sync-status", "**/ui/sync-status/*", "./sync-status", "./sync-status/*"],
							message: "The legacy sync-status presentation layer was removed; use ui/source-control instead.",
						},
						{
							group: ["**/SyncStatusView", "**/ui/SyncStatusView"],
							message: "The legacy SyncStatusView was replaced by SourceControlItemView (ui/source-control).",
						},
					],
				},
			],
		},
	},
	{
		// Architecture regression guard (docs/architecture.md): the UI layer
		// must reach the sync domain only through SyncWorkspace / the Source
		// Control application services -- never a concrete Git provider or a
		// push/pull coordinator/executor directly.
		files: ["src/ui/**/*.ts", "src/ui/**/*.tsx"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["**/services/github-service", "**/services/gitlab-service", "**/services/gitea-service"],
							message: "UI must not depend on a concrete Git provider; go through SyncWorkspace instead.",
						},
						{
							group: ["**/logic/sync/PushCoordinator", "**/logic/sync/PullCoordinator", "**/logic/sync/PushExecutor", "**/logic/sync/PullExecutor"],
							message: "UI must not bypass SyncWorkspace to reach a push/pull coordinator or executor directly.",
						},
					],
				},
			],
		},
	},
	{
		// Architecture regression guard (docs/architecture.md): the Source
		// Control application layer (ChangeRepository, SourceControlActionService,
		// SyncIntentExecutor, ...) must reach the sync domain only through
		// SyncWorkspace -- never a concrete Git provider or a push/pull
		// coordinator/executor directly.
		files: ["src/logic/source-control/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["**/services/github-service", "**/services/gitlab-service", "**/services/gitea-service"],
							message: "Source Control must not depend on a concrete Git provider; go through SyncWorkspace instead.",
						},
						{
							group: ["**/logic/sync/PushCoordinator", "**/logic/sync/PullCoordinator", "**/logic/sync/PushExecutor", "**/logic/sync/PullExecutor"],
							message: "Source Control must not bypass SyncWorkspace to reach a push/pull coordinator or executor directly.",
						},
					],
				},
			],
		},
	},
	{
		// Architecture regression guard (docs/architecture.md): sync-domain
		// modules (SyncManager, coordinators, executors, status resolution)
		// must not depend on the Source Control presentation layer -- the
		// dependency direction runs UI -> application -> domain, never back.
		files: ["src/logic/sync/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["**/ui/source-control", "**/ui/source-control/*"],
							message: "Sync-domain modules must not depend on the Source Control UI; the dependency direction runs UI -> domain, never back.",
						},
					],
				},
			],
		},
	},
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
			"obsidianmd/rule-custom-message": "off",
		},
	},
	{
		// These two suites deliberately exercise the pre-1.13 `display()`
		// imperative-render fallback (see PluginSettingTab.display() in
		// obsidian.d.ts) for back-compat coverage, so calling it is the point
		// of the test, not something to migrate away from.
		files: [
			"tests/ui/SettingsConnectionStatus.test.ts",
			"tests/ui/SettingsObsidian113Compatibility.test.ts",
		],
		rules: {
			"@typescript-eslint/no-deprecated": "off",
		},
	},
	{
		// CI contract suite asserts against the *committed* workflow/harness
		// files, so reading them from disk with node:fs is the point of the
		// test — same local-Node-tooling rationale as scripts/ above.
		files: ["tests/ci-workflow.test.ts"],
		rules: {
			"import/no-nodejs-modules": "off",
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
	{
		// These suites mock the Obsidian *plugin host environment* under Node
		// (vitest), not Obsidian's Electron renderer — the obsidianmd popout-
		// compatibility rules (window.createEl, activeWindow, window timers)
		// assume plugin runtime code, but here document/window/globalThis
		// shim globals that don't exist in a bare Node test process, and
		// createEl/createDiv/createSpan don't exist until the mock defines
		// them later in the file. Following the suggested rewrites (e.g.
		// swapping globalThis for window) breaks the tests.
		files: ["tests/setup.ts", "tests/ui/setup-dom.ts"],
		rules: {
			"obsidianmd/no-global-this": "off",
			"obsidianmd/prefer-create-el": "off",
			"obsidianmd/prefer-window-timers": "off",
		},
	},
	{
		// Local Node build tooling invoked by npm scripts, not plugin code;
		// typecheck-compat deliberately shells out to tsc. Reported as
		// warning-level by obsidianmd/no-nodejs-modules.
		files: ["scripts/typecheck-compat.mjs"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
	{
		// tseslint.config() is deprecated in favor of ESLint core
		// defineConfig() in typescript-eslint 8.68+; migrating is a separate
		// config refactor, not a code-quality issue.
		files: ["eslint.config.mts"],
		rules: {
			"@typescript-eslint/no-deprecated": "off",
		},
	},
	{
		// e2e-tests/** is Node test tooling (vitest, `environment: 'node'`) that
		// drives real GitHub/GitLab/Gitea sandboxes via the production provider
		// code path — not shipping Obsidian plugin runtime, so it gets the same
		// Node-tooling exemptions as scripts/ below. The real `requestUrl` shim
		// and the git-CLI verifier genuinely need fetch/node:child_process.
		// NOTE: an earlier committed-`.ts` version of this harness (see
		// docs/obsidian-scanner-audit.md) was flagged by the Obsidian
		// community-plugin scanner for these same APIs; that audit's own
		// finding was that the scanner's grep is not scoped to what ships in
		// main.js. Committing them again here under a new directory name is
		// unverified against the actual scanner until it's re-run — see the
		// "Known gaps" note this PR adds to docs/testing/real-provider-e2e.md.
		files: ["e2e-tests/**/*.ts", "vitest.e2e.config.ts"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			"import/no-nodejs-modules": "off",
			"no-restricted-globals": "off",
			"obsidianmd/rule-custom-message": "off",
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/no-global-this": "off",
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
