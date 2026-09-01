## [1.6.0](https://github.com/firstsun-dev/git-files-sync/compare/1.5.9...1.6.0) (2026-09-01)

### Features

* **conflict-modal:** wire SyncDiffService.getConflictStat as the batch conflict diff-stat loader ([246a59f](https://github.com/firstsun-dev/git-files-sync/commit/246a59f1d7991ab9f5eeb7e3a680436b97285ca7))
* **conflict-modal:** wire View Diff data through SyncDiffService ([ec9d356](https://github.com/firstsun-dev/git-files-sync/commit/ec9d3566ec99188244e25bfbd3366ddd14cde9b9))
* **source-control:** add Phase 2 action service ([70f6c9e](https://github.com/firstsun-dev/git-files-sync/commit/70f6c9e953d062e0423629922c3c735213315954))
* **source-control:** add Phase 3 source control UI ([7cec661](https://github.com/firstsun-dev/git-files-sync/commit/7cec661d136b1e73d3ddbc8c54144ac98d15ef81))
* **source-control:** add push-selection and operation-state foundation ([2d72022](https://github.com/firstsun-dev/git-files-sync/commit/2d7202247810e71d6e4bf83932151fa3d0e07391)), closes [#128](https://github.com/firstsun-dev/git-files-sync/issues/128)
* **source-control:** add remote-only download action and queue upload/download routing ([f9eb81b](https://github.com/firstsun-dev/git-files-sync/commit/f9eb81bfbbbbf34869ac8e5ab9d2a0f68e75c207))
* **source-control:** add ViewModel foundation layer ([76db082](https://github.com/firstsun-dev/git-files-sync/commit/76db0825758785bb3f93be651e4c46f9741c715b))
* **source-control:** full-width diff tab and mobile view-title dedup ([f449125](https://github.com/firstsun-dev/git-files-sync/commit/f4491254a1a7fe190e8a18dd2cf912c620426133))
* **source-control:** presentation adapter, diff stat, responsive mobile ([dd8ddd5](https://github.com/firstsun-dev/git-files-sync/commit/dd8ddd5761d5e146c7ae0a146bff60d882575f9f))
* **source-control:** selected-section rows, drop show-synced toggle, colored diff-stat ([853793c](https://github.com/firstsun-dev/git-files-sync/commit/853793c307925ef8aa286c9c12fefe9fbabc6084))
* **source-control:** split sync queue/repository regions and extract DiffStatProvider + SelectionController ([9fd1789](https://github.com/firstsun-dev/git-files-sync/commit/9fd17890730e2fdfac82e0f98507fdfbcf855d84)), closes [#136](https://github.com/firstsun-dev/git-files-sync/issues/136) [#135](https://github.com/firstsun-dev/git-files-sync/issues/135) [#136](https://github.com/firstsun-dev/git-files-sync/issues/136)
* **source-control:** wire Source Control view as the entry and remove legacy UI ([4e647fb](https://github.com/firstsun-dev/git-files-sync/commit/4e647fb32a892de39bda8dd84009699eee1f7f7c))
* **sync-status:** add refresh and operation feedback ([759b717](https://github.com/firstsun-dev/git-files-sync/commit/759b717da7e6d49dbc6f99e2dc18b5ab71480d59))
* **sync-status:** add selection workflow and sync action UI ([625fad2](https://github.com/firstsun-dev/git-files-sync/commit/625fad25c59911b07949db4f3af15aee3a9f3a5f))
* **sync:** auto-refresh status on local vault changes and distinguish local deletes ([4009f1d](https://github.com/firstsun-dev/git-files-sync/commit/4009f1da1ead9fc2ef50ed80dc3f5c87e5b47915)), closes [#66](https://github.com/firstsun-dev/git-files-sync/issues/66)
* **whats-new:** add onboarding layout for the Source Control workflow ([88e08dd](https://github.com/firstsun-dev/git-files-sync/commit/88e08dd23eb2d0fc644e465532dee983c8708e67))

### Bug Fixes

* **ci:** continue after intentionally skipped E2E jobs ([18de6e0](https://github.com/firstsun-dev/git-files-sync/commit/18de6e0bf848597ebba2ef23aec75ecca3c7094b))
* **ci:** fold E2E suite registration check into run-e2e.sh ([c2bfeb0](https://github.com/firstsun-dev/git-files-sync/commit/c2bfeb07dd7bf9500cb28ddb48e9f76dfb16985a))
* **ci:** isolate manual E2E concurrency ([b5884fc](https://github.com/firstsun-dev/git-files-sync/commit/b5884fc50d71a74d30c7f0fe7d04c54f6f1ab998))
* **ci:** run E2E suites through shared runner ([e9f0d28](https://github.com/firstsun-dev/git-files-sync/commit/e9f0d28ffc174e028869f6f20a1c72bafc55ca19))
* **ci:** serialize branch validation workflows ([acd2046](https://github.com/firstsun-dev/git-files-sync/commit/acd20467496c14c56befa87f0d5bf8a7c159b18d))
* **conflict-modal:** apply modal sizing CSS and add filename-first rows with progressive diff stats ([ac2bd2a](https://github.com/firstsun-dev/git-files-sync/commit/ac2bd2a610b9213d238c11e4f671e5834f3847a7))
* **deps:** bump undici and ip-address overrides to patched versions ([44c17ba](https://github.com/firstsun-dev/git-files-sync/commit/44c17ba8e9b6037226dcd5671701ba36c3459c87)), closes [#43-45](https://github.com/firstsun-dev/git-files-sync/issues/43-45) [#42](https://github.com/firstsun-dev/git-files-sync/issues/42) [#34-35](https://github.com/firstsun-dev/git-files-sync/issues/34-35)
* **e2e:** bound the requestUrl shim to a 30s timeout ([8d09aad](https://github.com/firstsun-dev/git-files-sync/commit/8d09aade5ed3be543123d644b5e2b9268ba11772))
* **e2e:** constrain generated runtime imports ([5dcd87e](https://github.com/firstsun-dev/git-files-sync/commit/5dcd87e377f368c4aa64d26019badaea66035e51))
* **e2e:** invalidate SourceControlScenario's remote cache on commitResolvedBatch ([257b2a4](https://github.com/firstsun-dev/git-files-sync/commit/257b2a4265647491db2b2ce3125cac33a9c97241))
* **e2e:** replace unsafe dynamic imports and align Obsidian lint ([3e9f709](https://github.com/firstsun-dev/git-files-sync/commit/3e9f7096af11d1fb4ebc848dbd27d40610c91467))
* **e2e:** resolve SonarCloud quality gate findings on new code ([38a5d9e](https://github.com/firstsun-dev/git-files-sync/commit/38a5d9e12333ef50bbaf0da77eab06a34defd8c9))
* **e2e:** scope two-client convergence checks to the run's own namespace ([2c7a473](https://github.com/firstsun-dev/git-files-sync/commit/2c7a4733f3c43b727e941aab721939a6d4da1e80))
* **e2e:** share the manager's SyncStatusService in the two-client fixture ([120dfe5](https://github.com/firstsun-dev/git-files-sync/commit/120dfe5166debf04a56295d17c6a084b3f5ae5d1))
* **i18n:** remove duplicate releaseHistory keys from concurrent fixes ([de55653](https://github.com/firstsun-dev/git-files-sync/commit/de5565324f702e822ec138a411bcb44db568196a))
* **settings:** keep release history accessible after dismiss ([c37e37c](https://github.com/firstsun-dev/git-files-sync/commit/c37e37ceffa4d86edce33ba9a985b74f8defd44d))
* **settings:** keep release history accessible after dismiss ([d6cdc36](https://github.com/firstsun-dev/git-files-sync/commit/d6cdc36049ee7d728e838e7b339b88292149e9d4))
* **source-control:** apply keep-remote-only batch plans and harden resolution tests ([2591e05](https://github.com/firstsun-dev/git-files-sync/commit/2591e0521febcb27ac97b6d0224914daa25c32b3))
* **source-control:** correct mobile queue and diff presentation ([b3720f7](https://github.com/firstsun-dev/git-files-sync/commit/b3720f7faf39fb5e08896cee176861c4ef0278ea))
* **source-control:** correct one-sided diff stat direction ([fbe0787](https://github.com/firstsun-dev/git-files-sync/commit/fbe0787cb5f709e94474a3971db1e295194a305d))
* **source-control:** correct status grouping and filter semantics ([0bcc800](https://github.com/firstsun-dev/git-files-sync/commit/0bcc8007a4b2f77850a5d3341ceeee216d26c51e))
* **source-control:** harden scroll, diff-stat and create lifecycles ([05f6628](https://github.com/firstsun-dev/git-files-sync/commit/05f66282cad12dd0a5e7e733e048b5ca646d9613))
* **source-control:** key selection and operation state by ChangeId ([4b09425](https://github.com/firstsun-dev/git-files-sync/commit/4b09425e75438a7ca17465876d0260897a2cde35))
* **source-control:** make keep-remote resolution authoritative ([c73c9cc](https://github.com/firstsun-dev/git-files-sync/commit/c73c9cc7262a1c4c1784e8213122606576090786))
* **source-control:** make sync actions actually sequential and clean up on remote delete ([2dfe78b](https://github.com/firstsun-dev/git-files-sync/commit/2dfe78be51ca68ed4af8cb2c2e99d42599ad51ef)), closes [#129](https://github.com/firstsun-dev/git-files-sync/issues/129)
* **source-control:** make whole view scroll, add clear-selection, click-to-collapse folders ([a9d3e98](https://github.com/firstsun-dev/git-files-sync/commit/a9d3e98956054555b419edbc0da1e4898d4ab7a2))
* **source-control:** pin Checked Changes, independent scroll for Changes tree ([d7606ff](https://github.com/firstsun-dev/git-files-sync/commit/d7606ffd9384791325a571e8c7316d6e282a0aef))
* **source-control:** preserve Changes tree scroll position on rerender ([10e344f](https://github.com/firstsun-dev/git-files-sync/commit/10e344f715dc06dd8fa306b453977654979a27b2))
* **source-control:** preserve mobile list position after diff ([709905a](https://github.com/firstsun-dev/git-files-sync/commit/709905af79e0574b413eb06a48edecf970f50de3))
* **source-control:** prevent duplicate sync status views ([2bbd042](https://github.com/firstsun-dev/git-files-sync/commit/2bbd04222ab7e8a90aaac3185d0a9add3e26dd32))
* **source-control:** refresh the open diff tab when its backing status changes ([10f9ead](https://github.com/firstsun-dev/git-files-sync/commit/10f9ead9a53967effd868be3b147c8e85ede2af8))
* **source-control:** repair diff stat cache lifecycle ([2d6cf91](https://github.com/firstsun-dev/git-files-sync/commit/2d6cf912aff5884690b0b8f86b789cae3e8dee40))
* **source-control:** route local-deleted to delete-remote, not pull-restore ([ebd8cb6](https://github.com/firstsun-dev/git-files-sync/commit/ebd8cb6c38eaa7bb6cc9d0e2defaa498d436c3e0)), closes [#129](https://github.com/firstsun-dev/git-files-sync/issues/129)
* **source-control:** track diff stat requests by generation token ([78a78e8](https://github.com/firstsun-dev/git-files-sync/commit/78a78e8e39b0dcd1ef0271e3306c50ccda5821bd))
* **source-control:** unify sync completion notification ([17b361f](https://github.com/firstsun-dev/git-files-sync/commit/17b361fab72db9a7bc552e6174e63bc540dd0a64))
* **sync-status:** preserve refreshed state across live modifications ([49f3033](https://github.com/firstsun-dev/git-files-sync/commit/49f3033bdde3331d0ea2a12816f47f91a09cc23c))
* **sync:** classify remote-only changes as remote-modified, not local-modified ([264cb47](https://github.com/firstsun-dev/git-files-sync/commit/264cb47047532756798da4aba3d2ab50de32a786))
* **sync:** report added/updated counts in push/pull toasts, i18n them ([b5eb1ae](https://github.com/firstsun-dev/git-files-sync/commit/b5eb1ae17676681cdf3ef8391816378e46c8e687))
* **sync:** stop remote-op failures from masking each other's outcome ([02bd3e3](https://github.com/firstsun-dev/git-files-sync/commit/02bd3e3615df2f2c5eab7bc6fbe1c99981ed0028))
* **test:** capture post-push head before asserting no-op repeat push ([039588f](https://github.com/firstsun-dev/git-files-sync/commit/039588feeef4d2956739534b13588404fbb984fd))
* **test:** show per-test progress in real-provider E2E CI logs ([54e3fb7](https://github.com/firstsun-dev/git-files-sync/commit/54e3fb75e82c35a9ab2abdafe89caec4d89d9302))

### Performance Improvements

* **ci:** gate and tier real-provider E2E ([b1d2208](https://github.com/firstsun-dev/git-files-sync/commit/b1d22083237a9bf563d641685618164a3c23641a))
* **test:** memoize remote reads in source-control-flows scenarios ([b9a90b2](https://github.com/firstsun-dev/git-files-sync/commit/b9a90b29a31b82254b6b4e9646ecec29db53a361))

### Documentation

* add source control refactor roadmap ([5d5645e](https://github.com/firstsun-dev/git-files-sync/commit/5d5645e6aac60d13ec5bf7e63e996e2c56fac272))
* align guides with source control workflow ([d4ce756](https://github.com/firstsun-dev/git-files-sync/commit/d4ce75600243f56149de701e45c9fec4b36523a7))
* **claude:** remove session-handoff references from agent workflow ([a4ccf9f](https://github.com/firstsun-dev/git-files-sync/commit/a4ccf9f6b8d81436adfafb3978e2fe092b49bf38))
* **imgs:** add sync-status screenshot ([a07a895](https://github.com/firstsun-dev/git-files-sync/commit/a07a8956d4283beaa69d440b59ad99c25e79a080))
* **progress:** record CI run 33358507732 triage ([9528528](https://github.com/firstsun-dev/git-files-sync/commit/952852813267a285c8ff862e9bce3969447f86e2))
* record CI green evidence for the whole-run concurrency ([8c07011](https://github.com/firstsun-dev/git-files-sync/commit/8c0701184d13e5dc3ec13176089a883087792529))
* record final-fix round in session handoff and progress ([17d241c](https://github.com/firstsun-dev/git-files-sync/commit/17d241c03bc2effda688cc9c3e3aeaf150dc2e3f))
* record Gitea E2E CI verification ([bf33cd2](https://github.com/firstsun-dev/git-files-sync/commit/bf33cd288594460dcea0559d6d1abeffb0b4a39e))
* record lifecycle hardening round in session handoff and progress ([9eb3713](https://github.com/firstsun-dev/git-files-sync/commit/9eb37132739109791b08d88ed5e749019d4c301a))
* record sync-status-workflow-ui completion in progress + handoff ([8aa8fdf](https://github.com/firstsun-dev/git-files-sync/commit/8aa8fdf66d0c33bbb67ff5a081ee86ddd16dcb8d))
* record unified sync notification verification ([25dfbc8](https://github.com/firstsun-dev/git-files-sync/commit/25dfbc81021dd1d1abb7dd0a053105f31a01fd63))
* restore README demo media ([daf7c81](https://github.com/firstsun-dev/git-files-sync/commit/daf7c817d426a6d99359ec419615b4a041cd4cb8))

### Code Refactoring

* **diff:** extract shared DiffViewer, gfs-conflict-modal shell, and gfs-diff-surface tokens ([769f82d](https://github.com/firstsun-dev/git-files-sync/commit/769f82d5d2bbf9f94d8d5bec3ea06e6ae88a3ae9))
* **source-control:** converge UI to sync-intent workflow ([639840a](https://github.com/firstsun-dev/git-files-sync/commit/639840a29bae86c930324914537812399be78667)), closes [#135](https://github.com/firstsun-dev/git-files-sync/issues/135)
* **source-control:** Selected section becomes a read-only action queue ([7538e0a](https://github.com/firstsun-dev/git-files-sync/commit/7538e0a8e4cf273e2d3480ad8f9280f540038838))
* **source-control:** staged/Changes split with collapsible sections ([60790a3](https://github.com/firstsun-dev/git-files-sync/commit/60790a3740119e16238424ea3b717d5feaa3848b))
* **source-control:** unify Sync into one plan, one commit ([264ae4b](https://github.com/firstsun-dev/git-files-sync/commit/264ae4b32cf418e3ae5e79d9311dca163b465ff1))
* **sync-status:** integrate source control view model ([8c69cc8](https://github.com/firstsun-dev/git-files-sync/commit/8c69cc8da702df74b6635c2991c999aaa990a5f7))
* **sync:** compact batch-conflict header and drop totalFiles from the interaction port ([a7dcda7](https://github.com/firstsun-dev/git-files-sync/commit/a7dcda74b39fcd96228d0f27a1591fa0b5a15d55))
* **test:** move real-provider E2E to e2e-tests/provider/, commit static runtime files ([376901f](https://github.com/firstsun-dev/git-files-sync/commit/376901f268bf72a56fa3b9ac6b94f2b49170d7f1)), closes [firstsun-dev/git-files-sync#143](https://github.com/firstsun-dev/git-files-sync/issues/143) [firstsun-dev/git-files-sync#142](https://github.com/firstsun-dev/git-files-sync/issues/142)

## [1.5.9](https://github.com/firstsun-dev/git-files-sync/compare/1.5.8...1.5.9) (2026-08-20)

### Bug Fixes

* **ci:** harden provider e2e failures ([948df28](https://github.com/firstsun-dev/git-files-sync/commit/948df28a122510468233c243d4bf32ab8fbab47f))
* **ci:** move matrix-dependent E2E gating out of job-level if ([155e55c](https://github.com/firstsun-dev/git-files-sync/commit/155e55c14fa7a8c19cfaa83da7d27d37605e6cef))
* **e2e:** dedupe push/pull_request E2E runs on the same branch ([04cd91a](https://github.com/firstsun-dev/git-files-sync/commit/04cd91a55e11a94ed5794bb80133a876fffafae5)), closes [#124](https://github.com/firstsun-dev/git-files-sync/issues/124)
* **e2e:** fix CI workflow-file rejection and Sonar security gate ([a44520a](https://github.com/firstsun-dev/git-files-sync/commit/a44520aa5393f3329c562b5d89beabce19daf7a6))
* **e2e:** fix commit-count pagination bug, guard teardown, log gitea failures ([147736e](https://github.com/firstsun-dev/git-files-sync/commit/147736e7a11ac053d8e220c6beadd191fae25d03))
* **e2e:** fix NOSONAR placement on line-continued curl calls ([b944023](https://github.com/firstsun-dev/git-files-sync/commit/b94402395368b1994409c00fd6f72af8444e739b))
* **e2e:** fix real CI failures found by the first live run ([b3c6b81](https://github.com/firstsun-dev/git-files-sync/commit/b3c6b81a4b05248af8306abf62e9ebfc85d03deb))
* **e2e:** prevent indefinite curl hangs in gitea provisioning ([2e083c2](https://github.com/firstsun-dev/git-files-sync/commit/2e083c2397e4c36b7fc2abc9211e504498aae9e1))
* **gitea:** preserve update semantics in mixed batch commits ([6569895](https://github.com/firstsun-dev/git-files-sync/commit/65698953adcf11bfef9ae8d1ae90e0a020d0fa95))
* **sync:** resolve batch conflicts before atomic push ([c8b4a84](https://github.com/firstsun-dev/git-files-sync/commit/c8b4a842ccbaaf4b73bd871025bc3909237eefc7))
* **sync:** route all push entry points through the batch push pipeline ([2d93d77](https://github.com/firstsun-dev/git-files-sync/commit/2d93d774762f5872ecdda260f1a1f57e940fc8d7))
* **sync:** unify push pull and move decisions ([dff95db](https://github.com/firstsun-dev/git-files-sync/commit/dff95dbc9d09fa938c74ac7e30ee067c2e8ded89))
* **ui:** make conflict viewer use available desktop space ([c802166](https://github.com/firstsun-dev/git-files-sync/commit/c8021661deaaa92c0d39867d525702b404c1f548))

### Documentation

* **e2e:** document real-provider E2E setup, CI, and troubleshooting ([60e2d2c](https://github.com/firstsun-dev/git-files-sync/commit/60e2d2cd6ae99d004b0ae58a3bf9fa1afe30b33a))
* **progress:** record Phase 0 E2E reconcile evidence ([a4de430](https://github.com/firstsun-dev/git-files-sync/commit/a4de430783a89c13eac19c8ce800eb6e36c93be9))
* **progress:** record PR [#124](https://github.com/firstsun-dev/git-files-sync/issues/124)'s three CI/Sonar fixes and final green state ([c42fa35](https://github.com/firstsun-dev/git-files-sync/commit/c42fa3525fb792e81f1d47027ed49d1b35a6f419))
* **progress:** record real CI results and gitea-disable follow-up ([c3acf83](https://github.com/firstsun-dev/git-files-sync/commit/c3acf831eb0bef0335ae5d4f64c08a938cb57e7b))
* record provider ci verification ([5f9d528](https://github.com/firstsun-dev/git-files-sync/commit/5f9d528bfa0fdc88227838d9cf1c3ce23dd77106))

### Code Refactoring

* **sync:** delete legacy single-file push orchestration ([3b3fd2e](https://github.com/firstsun-dev/git-files-sync/commit/3b3fd2e87a96e24d05116cc3a274d91c5c2e2467))

## [1.5.8](https://github.com/firstsun-dev/git-files-sync/compare/1.5.7...1.5.8) (2026-08-13)

## [1.5.7](https://github.com/firstsun-dev/git-files-sync/compare/1.5.6...1.5.7) (2026-08-07)

### Bug Fixes

* **scanner:** remove Node E2E source ([002000e](https://github.com/firstsun-dev/git-files-sync/commit/002000e86b3ea5fb29ecfb7e5a4ad691fcab5089))

## [1.5.6](https://github.com/firstsun-dev/git-files-sync/compare/1.5.5...1.5.6) (2026-08-07)

### Bug Fixes

* **e2e:** correct gitlab suite against real GitLab.com behavior ([77a3355](https://github.com/firstsun-dev/git-files-sync/commit/77a33552dc74f6a82c46862a37986db5ae89c93a)), closes [#101](https://github.com/firstsun-dev/git-files-sync/issues/101) [#101](https://github.com/firstsun-dev/git-files-sync/issues/101)

### Documentation

* **e2e:** write GitHub E2E test plan ([3cef03e](https://github.com/firstsun-dev/git-files-sync/commit/3cef03e962fb5d073a9a24aafee1cdefcd620b07))

## [1.5.5](https://github.com/firstsun-dev/git-files-sync/compare/1.5.4...1.5.5) (2026-08-07)

### Bug Fixes

* **provider:** preserve sync correctness ([ce61588](https://github.com/firstsun-dev/git-files-sync/commit/ce61588e7db9085dc6c8fdbda6b964734e33fa5a))

### Documentation

* tighten token permission guidance to least-privilege scopes ([#116](https://github.com/firstsun-dev/git-files-sync/issues/116)) ([45dc39d](https://github.com/firstsun-dev/git-files-sync/commit/45dc39d28de5fbb80a1b89b43a35fbff2b98f198))

## [1.5.4](https://github.com/firstsun-dev/git-files-sync/compare/1.5.3...1.5.4) (2026-08-07)

### Bug Fixes

* **sync:** ensure parent dirs exist when reverting file moves ([#114](https://github.com/firstsun-dev/git-files-sync/issues/114)) ([cda7137](https://github.com/firstsun-dev/git-files-sync/commit/cda7137ba5d3a30ddbc7ff2553f95b7bf3b6a36b)), closes [#94](https://github.com/firstsun-dev/git-files-sync/issues/94) [#6](https://github.com/firstsun-dev/git-files-sync/issues/6)

## [1.5.3](https://github.com/firstsun-dev/git-files-sync/compare/1.5.2...1.5.3) (2026-08-07)

### Bug Fixes

* **gitlab:** fix sha/revision semantics for optimistic locking ([#113](https://github.com/firstsun-dev/git-files-sync/issues/113)) ([ad15238](https://github.com/firstsun-dev/git-files-sync/commit/ad15238d84d82a6b9ae6ec52dc6a2544c7ab6458)), closes [#101](https://github.com/firstsun-dev/git-files-sync/issues/101)

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
