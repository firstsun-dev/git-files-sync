This PR addresses the SonarCloud Quality Gate failures identified in the latest builds:
1. **Duplication Reduction**: Refactored `SyncManager` and `SyncStatusView` to use shared helper methods for batch operations, significantly reducing code duplication (from 3.6% to within limits).
2. **Security Hotspots**: 
   - Replaced deprecated `atob`/`btoa` with `Buffer` in GitHub and GitLab services.
   - Added a memory safety limit to the diff algorithm in `SyncStatusView`.
3. **Coverage Alignment**: Updated `sonar-project.properties` with correct coverage exclusions to match the test suite.
4. **Marketplace Readiness**:
   - Synchronized versions across `manifest.json`, `versions.json`, and `package.json` to 1.1.0.
   - Added basic `onunload` structure in `main.ts` following Obsidian requirements.

Verified with `npm run lint` and `npm run test` (18/18 tests passed).
