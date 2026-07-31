## [1.5.1](https://github.com/firstsun-dev/git-files-sync/compare/1.5.0...1.5.1) (2026-07-31)

### Bug Fixes

* **deps:** release patched transitive dev-dep versions ([dc9525b](https://github.com/firstsun-dev/git-files-sync/commit/dc9525b4890764dffb6331bb00aa1888eaa8a590)), closes [#87](https://github.com/firstsun-dev/git-files-sync/issues/87)
* **release:** correct commit-analyzer releaseRules precedence ([b4b1808](https://github.com/firstsun-dev/git-files-sync/commit/b4b180874d2689b85ef06d4bebd3ac364c3723b0)), closes [#87](https://github.com/firstsun-dev/git-files-sync/issues/87)

### Documentation

* add simplified Chinese guide ([e7d5307](https://github.com/firstsun-dev/git-files-sync/commit/e7d530723816f63cfeb820cd44ca5c34c1d5ba41))
* archive session state as of 2026-07-31 ([908ebf7](https://github.com/firstsun-dev/git-files-sync/commit/908ebf783c4d836e7e1b01a55b5c116040220a44)), closes [#87](https://github.com/firstsun-dev/git-files-sync/issues/87) [#87](https://github.com/firstsun-dev/git-files-sync/issues/87)

## [1.5.0](https://github.com/firstsun-dev/git-files-sync/compare/1.4.0...1.5.0) (2026-07-28)

### Features

* add sync plan preview before applying changes ([#63](https://github.com/firstsun-dev/git-files-sync/issues/63)) ([1f227b2](https://github.com/firstsun-dev/git-files-sync/commit/1f227b24d3f9ba14ec68c5864e5507162ebfb1c1))
* **changelog:** add 1.5.0 update notes ([4385dcb](https://github.com/firstsun-dev/git-files-sync/commit/4385dcbc6bddf21bea9cca6fc4685fb87a66f85f))
* initial release ([118aaee](https://github.com/firstsun-dev/git-files-sync/commit/118aaeed31c45b3b39d4b7f8a314502d159750c2))
* initial release ([80a9111](https://github.com/firstsun-dev/git-files-sync/commit/80a91117cbf5c2610cae040a3d8c541dd5ad355a))
* **sync:** commit renames as a real move with a dedicated moved status ([7eb1141](https://github.com/firstsun-dev/git-files-sync/commit/7eb11418d4f94c3ad3a244ed59d41c2048f9aa7f))
* **sync:** refresh status on startup ([22c5ace](https://github.com/firstsun-dev/git-files-sync/commit/22c5ace905be2aa2259b4856df1fe7532e568d3c))
* **sync:** update a file's sync status live when it's edited in scope ([3373262](https://github.com/firstsun-dev/git-files-sync/commit/3373262f9328a646ddf008859c44414cd32f19f3))
* **sync:** update sync status live when a file is renamed or moved ([ae227a9](https://github.com/firstsun-dev/git-files-sync/commit/ae227a9154527880b02815a7edf949294650c01a))
* **ui:** add sync status tree view ([4426b24](https://github.com/firstsun-dev/git-files-sync/commit/4426b24bb62f9aef9e5c3d1e971aba921ff2f337))
* **ui:** collapse folder moves into a single row ([49a8816](https://github.com/firstsun-dev/git-files-sync/commit/49a881680beefc3c115b01540ed3bcea2eb0bb30))
* **ui:** use status dropdown on mobile ([eeef970](https://github.com/firstsun-dev/git-files-sync/commit/eeef970ca13955173040bb47fafac0a64de48401))

### Bug Fixes

* **sync:** backfill syncMetadata when a status refresh finds a file already synced ([1646ead](https://github.com/firstsun-dev/git-files-sync/commit/1646eadc8bc2952c5eef88568002ed46aafe0cde))
* **sync:** detect a folder move even when the plugin missed the live rename event ([c806e22](https://github.com/firstsun-dev/git-files-sync/commit/c806e22ab6b6283c954e4bb568b62d5602389a0a))
* **sync:** honor ignore patterns for direct push ([61ca728](https://github.com/firstsun-dev/git-files-sync/commit/61ca7288ad788f2eba0f34657c637dd09afbad20))
* synchronize manifest version with git tag and assets ([d9eab83](https://github.com/firstsun-dev/git-files-sync/commit/d9eab830244d9f6477385f8aa2030a9b9bf5efcf))
* **sync:** keep a single-file push's status as synced, not unsynced ([690b8ee](https://github.com/firstsun-dev/git-files-sync/commit/690b8ee92f70100912d91d440a2157148008109d))
* **sync:** reconcile moves from legacy metadata ([ed04867](https://github.com/firstsun-dev/git-files-sync/commit/ed0486724956bef8d3230f2be0f1fc6ffa15c5e0))
* **sync:** show progress toast and avoid N sequential rename checks on single-file push ([217dcf5](https://github.com/firstsun-dev/git-files-sync/commit/217dcf57d9c805df12df604cd524eef099de761d))
* **sync:** stop clearing rename metadata on generic vault delete events ([c9d0cde](https://github.com/firstsun-dev/git-files-sync/commit/c9d0cde29719d0ddae014e83a6f3440a29463624)), closes [#66](https://github.com/firstsun-dev/git-files-sync/issues/66)
* **sync:** track a moved folder's files, not just moved files ([ee217b1](https://github.com/firstsun-dev/git-files-sync/commit/ee217b151d8785cf69a37fda8a3f0c70e1c412b1)), closes [#66](https://github.com/firstsun-dev/git-files-sync/issues/66) [#67](https://github.com/firstsun-dev/git-files-sync/issues/67)
* trigger release to publish updated manifest ([ab538d8](https://github.com/firstsun-dev/git-files-sync/commit/ab538d8495ebb955dba1865c1e16668d7817bb71))
* **ui:** show diff for moved files ([9f82d36](https://github.com/firstsun-dev/git-files-sync/commit/9f82d369057d50ee982edacd0fcf460c88210454))

### Documentation

* record direct push ignore guard ([fe084b4](https://github.com/firstsun-dev/git-files-sync/commit/fe084b465ab0e96b9ea41eba3bcddb1672848f84))
* record legacy move reconciliation ([3e65e63](https://github.com/firstsun-dev/git-files-sync/commit/3e65e63626173852b6f2407daee058c532443ae1))
* record rename regression coverage ([c648712](https://github.com/firstsun-dev/git-files-sync/commit/c64871235b5239fc35b0a08fe2175b46e8f8222e))
* record shared sync status state ([7510ce7](https://github.com/firstsun-dev/git-files-sync/commit/7510ce7b620712f1786fa36b49fec4e2cf0231e8))
* record sync status refactor handoff ([ac6eec6](https://github.com/firstsun-dev/git-files-sync/commit/ac6eec684e1aee01058204d64fa84aa40ef9499c))

### Code Refactoring

* **sync-status:** centralize status classification ([c610dde](https://github.com/firstsun-dev/git-files-sync/commit/c610dde309cdd5209e866a4749da471df67aa253))
* **sync-status:** share status state with sync manager ([9cefb25](https://github.com/firstsun-dev/git-files-sync/commit/9cefb25e7319d32a9f264e8d96a352f13b446ace))
* **ui:** move tree view controls ([e47d44b](https://github.com/firstsun-dev/git-files-sync/commit/e47d44b61956bef55c5e4b3aa06a7c2ebdd1a59a))

## [1.4.0](https://github.com/firstsun-dev/git-files-sync/compare/1.3.2...1.4.0) (2026-07-23)

### Features

* **ui:** add path search, click-to-open, and a desktop diff pane ([c761951](https://github.com/firstsun-dev/git-files-sync/commit/c76195109f181e413afc18bdab15e45f49c4a378)), closes [#70](https://github.com/firstsun-dev/git-files-sync/issues/70) [#68](https://github.com/firstsun-dev/git-files-sync/issues/68) [#69](https://github.com/firstsun-dev/git-files-sync/issues/69) [#68](https://github.com/firstsun-dev/git-files-sync/issues/68) [#69](https://github.com/firstsun-dev/git-files-sync/issues/69) [#70](https://github.com/firstsun-dev/git-files-sync/issues/70)

### Bug Fixes

* **github:** read the snapshot's branch head over GraphQL ([0af0746](https://github.com/firstsun-dev/git-files-sync/commit/0af0746ac3f2da89b4d116567edcf2f994e7f01c))
* **ui:** let desktop diff tab fill the full pane height ([72a2c97](https://github.com/firstsun-dev/git-files-sync/commit/72a2c976f7a8115d8e95adffbd87068222758464)), closes [#69](https://github.com/firstsun-dev/git-files-sync/issues/69)
* **ui:** prune the selection to the filter instead of clearing it ([109a77f](https://github.com/firstsun-dev/git-files-sync/commit/109a77f6757e2e7af6a2879255e23a4260551c1d))

## [1.3.2](https://github.com/firstsun-dev/git-files-sync/compare/1.3.1...1.3.2) (2026-07-23)

### Bug Fixes

* **github:** retry batch pushes when the branch head moves ([65b5a3c](https://github.com/firstsun-dev/git-files-sync/commit/65b5a3c8d37f3fc31c3489194fafc228b2c50d0f))
* **sync:** record a blob sha for batch-pushed files ([44716e3](https://github.com/firstsun-dev/git-files-sync/commit/44716e3b3a3e346e92e4fae1a4832c3a5e8ce28e))

### Performance Improvements

* **sync:** decide gitignore and pull work from the remote tree ([6ed91d9](https://github.com/firstsun-dev/git-files-sync/commit/6ed91d9051043d91a3603507083d44f17e5df3dd))
* **sync:** stop probing paths the remote tree already rules out ([4b65fb7](https://github.com/firstsun-dev/git-files-sync/commit/4b65fb716d615cb38f5eedfbc7969ffdbb0bbb3a))

## [1.3.1](https://github.com/firstsun-dev/git-files-sync/compare/1.3.0...1.3.1) (2026-07-23)

### Performance Improvements

* **push:** avoid stale rename lookup requests ([f8a0a26](https://github.com/firstsun-dev/git-files-sync/commit/f8a0a269f1d8f8bda8271480c4b6078d608d6c25))
* **push:** eliminate redundant GitHub requests ([0445b17](https://github.com/firstsun-dev/git-files-sync/commit/0445b170a2960e59812df04b7a8f93c62fb441c0))

## [1.3.0](https://github.com/firstsun-dev/git-files-sync/compare/1.2.1...1.3.0) (2026-07-14)

### Features

* add i18n (multi-language) support ([#38](https://github.com/firstsun-dev/git-files-sync/issues/38)) ([144eb28](https://github.com/firstsun-dev/git-files-sync/commit/144eb286d8372c9fe24c52b4730a837650731212))
* add Simplified Chinese locale, settings what's-new banner, and 1.3.0 changelog ([72ed2cd](https://github.com/firstsun-dev/git-files-sync/commit/72ed2cde75a7360b00e2dd4faa146efcb3890c51))
* resize conflict modal, add connection status badge, and local ignore patterns ([28f4f8e](https://github.com/firstsun-dev/git-files-sync/commit/28f4f8efd015dc89a2eb7459fbad224626597d5f)), closes [#42](https://github.com/firstsun-dev/git-files-sync/issues/42) [#41](https://github.com/firstsun-dev/git-files-sync/issues/41)
* **settings:** add folder picker for root path and vault folder settings ([c107979](https://github.com/firstsun-dev/git-files-sync/commit/c107979427c2cdfabd6a8411c12dbe825356a78a)), closes [#48](https://github.com/firstsun-dev/git-files-sync/issues/48)
* show new feature tips after update ([4eebebc](https://github.com/firstsun-dev/git-files-sync/commit/4eebebc765b1495ebc49baf38f8f08eff9bf3520)), closes [#39](https://github.com/firstsun-dev/git-files-sync/issues/39)
* **ui:** show connection status in the global status bar ([83499c9](https://github.com/firstsun-dev/git-files-sync/commit/83499c92e8ddec59aa2340fac7c2c05262290c3b))

### Bug Fixes

* don't mark the symlink-pull fix as notable in 1.3.0 changelog ([1fc27ab](https://github.com/firstsun-dev/git-files-sync/commit/1fc27ab1b6cb91912eb8fb280a12f7fa1e7affa4))
* normalize vaultFolder-relative path before gitService.deleteFile ([fa42fea](https://github.com/firstsun-dev/git-files-sync/commit/fa42fea5fdb50c0a1bcc28620d0c5194048e82b9))
* **push:** avoid stale remote-tree read right after a batch push ([7676325](https://github.com/firstsun-dev/git-files-sync/commit/76763250881e382614d1aa31b1d8ca742cc9b014))
* **push:** retry GitHub commit mutations on a stale expectedHeadOid ([33d41ac](https://github.com/firstsun-dev/git-files-sync/commit/33d41ac89ba120afa88475ae8e5f0d4dc525dab7))
* remote-repo root path picker, delete-remote-only-file errors, symlinked-folder EISDIR ([896d77b](https://github.com/firstsun-dev/git-files-sync/commit/896d77bddffa5059593e8875b84e656847f4b3f7)), closes [firstsun-dev/blog#78](https://github.com/firstsun-dev/blog/issues/78)
* satisfy Obsidian plugin scan (undescribed directive, popout-window timers) ([09bdf0c](https://github.com/firstsun-dev/git-files-sync/commit/09bdf0c0c716da7e857106891663a6cc1b8f4f05))
* surface a clear error when requestUrl() itself rejects with HTML content ([a867217](https://github.com/firstsun-dev/git-files-sync/commit/a86721752a77529b4ebe631311bd4f31c64a5e48)), closes [#31](https://github.com/firstsun-dev/git-files-sync/issues/31)
* symlinked directories no longer break pull discovery ([4c8896b](https://github.com/firstsun-dev/git-files-sync/commit/4c8896b6fa2bc5eae40d67168e171955a9234ed9)), closes [#33](https://github.com/firstsun-dev/git-files-sync/issues/33)
* **sync:** clear sync metadata on vault file delete ([1a369b3](https://github.com/firstsun-dev/git-files-sync/commit/1a369b36ed22e396906d7b34b4c9c156d38f8c76))
* **ui:** connection status badge text invisible on some themes ([12cce64](https://github.com/firstsun-dev/git-files-sync/commit/12cce6497e9932f772b4b17a401e5369bbb118f2))

### Performance Improvements

* **delete:** batch-commit remote-only file deletion ([d8e3663](https://github.com/firstsun-dev/git-files-sync/commit/d8e3663b8f11eacc235aea1d40deb25c70567fbb))
* **push:** batch-commit push-all files + SHA-based diffing ([c28e0ec](https://github.com/firstsun-dev/git-files-sync/commit/c28e0ec09a566762f05dc4be88f46bae84c853e6))
* **push:** GitHub batch push/delete via GraphQL createCommitOnBranch ([114a575](https://github.com/firstsun-dev/git-files-sync/commit/114a5759a7ee034ea99e6ae730024502062445fd))
* **push:** parallelize blob creation within a batch commit ([c7ae0f6](https://github.com/firstsun-dev/git-files-sync/commit/c7ae0f675473716281ab32a38bb22a934dcf3b07))
* **refresh:** use tree blob SHAs to avoid per-file content fetches ([2ed5a43](https://github.com/firstsun-dev/git-files-sync/commit/2ed5a436b07974a40e36b06e1cd57a15f614567a)), closes [#36](https://github.com/firstsun-dev/git-files-sync/issues/36)

### Code Refactoring

* **tests:** dedupe TextComponent/TextAreaComponent mocks ([f5ae8ef](https://github.com/firstsun-dev/git-files-sync/commit/f5ae8ef16df930578eeef3e467577c7873b01334)), closes [#49](https://github.com/firstsun-dev/git-files-sync/issues/49)

## [1.2.1](https://github.com/firstsun-dev/git-files-sync/compare/1.2.0...1.2.1) (2026-07-07)

### Bug Fixes

* **compat:** support Obsidian down to 1.11.0 ([d896015](https://github.com/firstsun-dev/git-files-sync/commit/d8960157655e57e61e897483c493edd6a852bd45))

### Documentation

* restyle README, host demo videos on R2, use official download stats ([#44](https://github.com/firstsun-dev/git-files-sync/issues/44)) ([0a4cff5](https://github.com/firstsun-dev/git-files-sync/commit/0a4cff5a46467a7719b123dfebd9afadc26856b3))

## [1.2.0](https://github.com/firstsun-dev/git-files-sync/compare/1.1.2...1.2.0) (2026-07-05)

### Features

* add Gitea support as third-party Git provider ([130bd93](https://github.com/firstsun-dev/git-files-sync/commit/130bd93f84161086bdf7f3574098250ef0950c4b)), closes [#26](https://github.com/firstsun-dev/git-files-sync/issues/26)
* **sync:** detect symbolic links and add a configurable handling setting ([62b475d](https://github.com/firstsun-dev/git-files-sync/commit/62b475d6326c0705cc5120c77ba88719b8454e39))
* **sync:** real symbolic link support (GitHub) with configurable handling ([9bcaed6](https://github.com/firstsun-dev/git-files-sync/commit/9bcaed65f434a4c1596b5403f66df41a9887243b))

### Bug Fixes

* **deprecations:** migrate off deprecated Obsidian APIs ([5c64b96](https://github.com/firstsun-dev/git-files-sync/commit/5c64b96c084430cffefc6fab47fb98b411a18c55))
* **deps:** resolve Dependabot security alerts in dev dependencies ([a47cfcb](https://github.com/firstsun-dev/git-files-sync/commit/a47cfcb708d20d852018ea4de4bfd8eb250cfd6a))
* **lint:** resolve Obsidian plugin linter warnings ([d11ca94](https://github.com/firstsun-dev/git-files-sync/commit/d11ca94073d7a36bac673ceb76c2d1815eebcd0a))
* **services:** clear error when Git API returns HTML instead of JSON ([bcc5cda](https://github.com/firstsun-dev/git-files-sync/commit/bcc5cda69ca7e4fa63474d0221f52f910a13076b))
* **services:** omit blank sha so creating a new file doesn't 422 ([339d5cb](https://github.com/firstsun-dev/git-files-sync/commit/339d5cbe775bc27ea4cca3e6d474366fdc017048))
* **services:** stop logging expected 404s as errors during refresh ([c474a7e](https://github.com/firstsun-dev/git-files-sync/commit/c474a7e6c4da02fe44770b6d2e914f962a3455f3))
* **settings:** mask personal access token fields ([235d9e0](https://github.com/firstsun-dev/git-files-sync/commit/235d9e09766db0e3426e98b78385f6ab4d5f1c54))
* **sync:** clearer branch-not-found errors and connection test ([2f6859a](https://github.com/firstsun-dev/git-files-sync/commit/2f6859a2f1cfb01fcce04f5dcd9a94df5989ffd3))
* **sync:** fall back to adapter read for symlinked files ([76405cf](https://github.com/firstsun-dev/git-files-sync/commit/76405cf2f796a18651dcae86a188c86a51f69270))
* **sync:** stop batch push/pull from silently overwriting conflicts ([1364b94](https://github.com/firstsun-dev/git-files-sync/commit/1364b94f0a4063c84649c278990ed7116f95196a))
* **sync:** stop false-positive rename detection and 422 on rename push ([06953e1](https://github.com/firstsun-dev/git-files-sync/commit/06953e1b12e4b4380658b443ce505a6a14fe1b4b))
* **ui:** keep ribbon/command labels in sync with configured Git service ([acebafd](https://github.com/firstsun-dev/git-files-sync/commit/acebafd94a434e574686ad61878ce66f8173d1c1))
* **ui:** match Open sync status ribbon icon to the view icon ([9bc8ab7](https://github.com/firstsun-dev/git-files-sync/commit/9bc8ab7d082a933adca973c2de59337166dc940f))
* use two-step branch→SHA resolution in GiteaService.listFiles ([7648eef](https://github.com/firstsun-dev/git-files-sync/commit/7648eef279ed63a61561f217f206abf892995964))

### Performance Improvements

* **ui:** parallelize refresh status checks and throttle re-renders ([1e21061](https://github.com/firstsun-dev/git-files-sync/commit/1e21061aa84f49b708326cc6ea7046c12579d2d0))

### Documentation

* add video ([#30](https://github.com/firstsun-dev/git-files-sync/issues/30)) ([49bfe9f](https://github.com/firstsun-dev/git-files-sync/commit/49bfe9f4c26aede711b0aff011127fbcbf678593))
* fix CLAUDE.md to match actual codebase and remove subagent delegation directives ([#32](https://github.com/firstsun-dev/git-files-sync/issues/32)) ([85bcaba](https://github.com/firstsun-dev/git-files-sync/commit/85bcaba81f56bf82ffde890f7027e39afb3aaae8))
* update intro video with refreshed content ([df44a96](https://github.com/firstsun-dev/git-files-sync/commit/df44a96c9bc2cc53d58592616b2cb6c614eb5fde))
* update USAGE_zh.md with Gitea support and provider compatibility table ([615819c](https://github.com/firstsun-dev/git-files-sync/commit/615819c39ebbaafe07c20634b191b11202683c3e))

### Code Refactoring

* **ui:** unify Sync Status icons via Lucide setIcon ([d8d6f9d](https://github.com/firstsun-dev/git-files-sync/commit/d8d6f9dcb11f01918be90b68ea697e283313de64))

## [1.1.2](https://github.com/firstsun-dev/git-files-sync/compare/1.1.1...1.1.2) (2026-06-16)

### Bug Fixes

* **lint:** replace activeWindow.setTimeout with setTimeout ([4099f44](https://github.com/firstsun-dev/git-files-sync/commit/4099f44fa5643ce5799eef74fb23f41fae0da991))

## [1.1.1](https://github.com/firstsun-dev/git-files-sync/compare/1.1.0...1.1.1) (2026-06-16)

### Bug Fixes

* **ci:** switch to shared workflow v1 and fix repository url ([3a0f99e](https://github.com/firstsun-dev/git-files-sync/commit/3a0f99e3832e5e288ad586ed856252f829a828ec))

## [1.1.0](https://github.com/firstsun-dev/git-files-sync/compare/1.0.6...1.1.0) (2026-06-16)

### Features

* support hidden file sync and expand binary extension list ([649d732](https://github.com/firstsun-dev/git-files-sync/commit/649d7327818f3349b475c57098015eda0a6073ed))

### Documentation

* remove SonarCloud quality gate badge from README ([d907baf](https://github.com/firstsun-dev/git-files-sync/commit/d907baf229adaa6d34d6c67c75c8d4825a4751ed))
* update README badges ([7cd9e38](https://github.com/firstsun-dev/git-files-sync/commit/7cd9e38e65ee98c4c4d9854db7f7209a5c1cef61))

### Code Refactoring

* **test:** eliminate duplicate code flagged by SonarCloud ([f49600e](https://github.com/firstsun-dev/git-files-sync/commit/f49600eb667f917d445dda450dffb3e4d0128324))
* **test:** extract shared SyncManager mock setup to reduce duplication ([1f71a43](https://github.com/firstsun-dev/git-files-sync/commit/1f71a43980cc01b547896a068c4944e692776847))

## [1.0.6](https://github.com/firstsun-dev/git-files-sync/compare/1.0.5...1.0.6) (2026-05-20)

### Bug Fixes

* **release:** trigger patch release on chore(deps) commits ([910305a](https://github.com/firstsun-dev/git-files-sync/commit/910305a81c7e123e3fd39f1d9340a97d158c6b1b))
* **test:** add @types/jsdom and fix Element type cast in setup-dom ([8f7207a](https://github.com/firstsun-dev/git-files-sync/commit/8f7207a3886100844ee2c98e5d293f953448ed86))
* **ui:** real-time file status during refresh and unsynced file actions ([c6152a6](https://github.com/firstsun-dev/git-files-sync/commit/c6152a61bb1967a178a85c2097290fdc1286edbe))

### Code Refactoring

* code quality enhancements for issue [#23](https://github.com/firstsun-dev/git-files-sync/issues/23) ([7f223e3](https://github.com/firstsun-dev/git-files-sync/commit/7f223e33b8fccc228a93bc1e1224d50a3dda1127))
* code quality enhancements for issue [#23](https://github.com/firstsun-dev/git-files-sync/issues/23) ([31ac918](https://github.com/firstsun-dev/git-files-sync/commit/31ac9189cf921f49fb891adbf45d15b07d2cf049))
* eliminate code duplication flagged by SonarCloud ([556f9e9](https://github.com/firstsun-dev/git-files-sync/commit/556f9e930d1f573e644497f31d70dd39a8611500))

## [1.0.5](https://github.com/firstsun-dev/git-files-sync/compare/1.0.4...1.0.5) (2026-04-26)

### Code Refactoring

* address SonarCloud issues and reduce code duplication ([#20](https://github.com/firstsun-dev/git-files-sync/issues/20)) ([4574abc](https://github.com/firstsun-dev/git-files-sync/commit/4574abc294eebd0f9be27c256bc93150261ad764))
* fix quality gate issues, improve type safety and pagination ([#21](https://github.com/firstsun-dev/git-files-sync/issues/21)) ([70171fd](https://github.com/firstsun-dev/git-files-sync/commit/70171fd5d7cbae9e0943c21b6317e89fdd72c8bc))

# Changelog
