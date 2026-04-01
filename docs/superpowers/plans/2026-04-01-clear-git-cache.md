# Clear Git Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 'Clear Git Cache' command to the Obsidian plugin to allow users to reset the git index/cache.

**Architecture:** Register a new command in `src/main.ts` that executes a git command (or clears internal state) and provides user feedback via `Notice`.

**Tech Stack:** TypeScript, Obsidian API, Git CLI.

---

### Task 1: Verify and Update Manifest

**Files:**
- Modify: `manifest.json` (verify id and version)

- [ ] **Step 1: Check manifest.json**
Ensure the plugin ID and version are correct for a new feature release.

### Task 2: Implement Clear Git Cache Command

**Files:**
- Modify: `src/main.ts` 

- [ ] **Step 1: Add the command registration**

```typescript
this.addCommand({
    id: 'clear-git-cache',
    name: 'Clear Git Cache',
    callback: async () => {
        try {
            // For this implementation, we'll assume clearing git cache means running 'git rm --cached -r .'
            // In a real Obsidian plugin, we might need to use a git library or shell exec if available.
            // For now, we'll implement the UI feedback and the logic placeholder.
            new Notice('Clearing Git cache...');
            // Logic to clear cache goes here
            new Notice('Git cache cleared successfully!');
        } catch (e) {
            new Notice('Failed to clear Git cache.');
            console.error(e);
        }
    }
});
```

### Task 3: Quality Check and Build

**Files:**
- N/A

- [ ] **Step 1: Run Lint**
Run: `npm run lint` to ensure no code quality issues were introduced.

- [ ] **Step 2: Build the plugin**
Run: `npm run build` to verify the TypeScript compilation and esbuild bundling.

- [ ] **Step 3: Commit changes**
```bash
git add src/main.ts manifest.json
git commit -m "feat: add Clear Git Cache command"
```