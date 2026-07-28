# Session Handoff

**Date:** 2026-07-28
**Branch:** `prepare-1.5.0`

## Completed

- Added `src/changelog/1.5.0/index.ts` with the approved six What's New highlights in English, Traditional Chinese, and Simplified Chinese. The order is: preview changes, real file moves, tree view, live status, startup refresh, and interface refinements.
- Added a localized **View on GitHub** button in `WhatsNewModal`, linking to `https://github.com/firstsun-dev/git-files-sync`; the existing full changelog button remains.
- Added regression coverage ensuring the 1.5.0 release has all six entries in all three languages.

## Verification

```
npx eslint .    -> 0 errors
npm run build   -> passes (including Obsidian 1.11.0 compatibility)
npx vitest run  -> 33 files, 494 tests passed
```

## Exact Next Step

Manually verify the 1.5.0 What's New modal in Obsidian, including all three language selections and both external GitHub buttons. The existing tree-view manual verification for `feat-025` remains outstanding.
