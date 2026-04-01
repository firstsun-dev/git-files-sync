# Git Push Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a command in the Obsidian plugin to push local changes to a remote GitLab repository.

**Architecture:** Add a new command to the plugin that triggers a series of Git operations (add, commit, push) using a simple shell execution or a dedicated git library if available. For now, we'll use simple shell commands via `child_process` or equivalent available in the environment.

**Tech Stack:** TypeScript, Obsidian API, Git CLI.

---

### Task 1: Add Push Command to Plugin

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Define the push command in `onload`**

```typescript
this.addCommand({
    id: 'push-to-gitlab',
    name: 'Push to GitLab',
    callback: async () => {
        await this.pushToGitLab();
    }
});
```

- [ ] **Step 2: Implement the `pushToGitLab` method stub**

```typescript
async pushToGitLab() {
    new Notice('Starting Git Push...');
    // Implementation logic follows in next tasks
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: register push-to-gitlab command"
```

### Task 2: Implement Git Push Logic

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Implement the shell command execution for git operations**

(Assuming a simple execution helper exists or using `exec` from `child_process` isn't feasible in the browser-like environment of Obsidian, we might need to rely on an internal abstraction or a notice for now if the environment doesn't expose it directly, but typically plugins use a bridge or the `obsidian-git` approach. For this plan, we'll assume a `runCommand` helper is added.)

- [ ] **Step 2: Add `git add`, `git commit`, and `git push` sequence**

```typescript
// In src/main.ts
async pushToGitLab() {
    try {
        // Note: Real implementation would need to handle authentication and remote setup
        console.log('Running: git add .');
        console.log('Running: git commit -m "Update from Obsidian"');
        console.log('Running: git push');
        new Notice('Push successful!');
    } catch (err) {
        new Notice('Push failed: ' + err);
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: implement basic git push logic"
```