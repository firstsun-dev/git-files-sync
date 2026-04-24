---
allowed-tools: Agent(dev-tasks), Bash(git add:*), Bash(git status:*), Bash(git commit:*)
description: Complete commit-push-PR workflow for GitLab/GitHub. Use when user asks to commit, push, or create MR/PR. Enforces quality checks and delegates to dev-tasks.
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Git platform: !`git remote get-url origin`

## Your task

Based on the above changes, delegate to dev-tasks agent with a comprehensive prompt:

**Spawn ONE dev-tasks agent** with the following instructions:

```
Complete the commit-push-pr workflow:

Current branch: [branch name from context]
Changes: [summarize from git diff]
Platform: [GitLab if origin contains 'gitlab', GitHub if contains 'github.com']

Steps:
1. Run quality checks (skip if changes are only to *.md, CLAUDE.md, or .claude/ files):
   - pnpm run check
   - pnpm lint
   - pnpm test:e2e (if external service tests fail with timeouts, note them but proceed)
   - If any check fails with actual code errors, STOP and report

2. Safety check: Run `git status --porcelain` and verify no .gitignore patterns (node_modules, .pnpm-store, .env, etc.) would be staged

3. Stage files: git add [specific files, never use -A]

4. Create commit with conventional commit message including:
   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

5. Push: git push origin [branch] (or git push -u origin [branch] if new)

6. If not on main and MR/PR doesn't exist:
   - GitLab: glab mr create --repo firstsun-dev/blog --title "[title]" --description "[description]" --remove-source-branch --yes
   - GitHub: gh pr create --title "[title]" --body "[description]"

7. If MR/PR was created, enable auto-merge:
   - GitLab: parse MR IID from output, then run glab mr merge [iid] --repo firstsun-dev/blog --auto-merge --yes
   - GitHub: gh pr merge --auto --squash

8. Monitor CI:
   - GitLab: glab ci status --repo firstsun-dev/blog --live
   - GitHub: gh run watch
```

**IMPORTANT**: You must spawn the agent with `run_in_background: false` so you can report the result to the user.
