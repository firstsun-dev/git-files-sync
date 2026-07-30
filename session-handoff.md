# Session Handoff

**Date:** 2026-07-29
**Branch:** `prepare-1.5.0`

## Completed

- Updated `README.md` for the current 1.5.0 feature set: sync-plan review, real file/folder moves, live and startup status refresh, path search, optional tree view with folder selection, desktop Diff pane, and the three supported interface languages.
- Updated the Traditional Chinese guide, `USAGE_zh.md`, with the same current workflow and feature information.
- Added `USAGE_zh-cn.md`, a Simplified Chinese guide, and connected all three documentation languages with navigation links.
- Recommended three new screenshots for a future documentation polish: sync-plan confirmation, tree view with folder selection, and the desktop Diff pane.

## Verification

```
./init.sh        -> npm run lint clean; npm test: 33 files, 494 tests passed; npm run build passes
git diff --check -> passes
relative-link check across README.md, USAGE_zh.md, USAGE_zh-cn.md -> no missing local links
```

## Exact Next Step

Manually verify the 1.5.0 What's New modal in Obsidian, including all three language selections and both external GitHub buttons. The existing tree-view manual verification for `feat-025` remains outstanding.
