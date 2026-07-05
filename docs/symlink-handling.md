# Symbolic Link Handling

This document describes how Git File Sync syncs **symbolic links** (symlinks)
between your vault and the remote repository.

## Background

In Git, a symbolic link is not a normal file — it is stored as a *blob with file
mode `120000`* whose **content is the link's target path** (for example
`../shared/note.md`). Because of this, symlinks need special treatment:

- They cannot be fetched/created like normal files through every provider's API.
- Obsidian exposes no symlink API, and **mobile platforms (iOS/Android) cannot
  create OS-level symlinks at all**.

To keep behavior predictable, Git File Sync makes symlink handling an explicit,
configurable choice.

## The setting

**Settings → Git File Sync → Symbolic links**

| Mode | What it does |
| :--- | :--- |
| **Real symlink** (default) | Recreates a real OS symlink on **desktop** when pulling, and pushes local symlinks back as real Git symlinks (mode `120000`). Falls back to content on platforms/providers that can't do this (see below). |
| **Follow** | Treats a symlink as the file it points to: syncs the **target's content** as a normal file. Never creates links. |
| **Skip** | Ignores symlinks entirely — they are not listed, pulled, or pushed. |

The default is **Real symlink**.

## Provider support

Creating a symlink on the remote requires writing a `120000` blob, which is only
possible with a provider that exposes the full **Git Data API**.

| Provider | Real symlink | Notes |
| :--- | :---: | :--- |
| **GitHub** | ✅ | Full support via the Git Data API (blob → tree → commit → ref). |
| **GitLab** | ❌ | The Commits API can't set the symlink mode. "Real" is treated as **Skip**. |
| **Gitea** | ❌ | No write access to git data endpoints. "Real" is treated as **Skip**. |

**Config safeguard (防呆):** the "Real symlink" option is only offered in the
settings dropdown when the active provider is GitHub. On other providers a saved
value of `real` is automatically treated as `skip`, so a symlink is never
silently turned into an ordinary file.

## Platform behavior

| | Desktop | Mobile (iOS/Android) |
| :--- | :--- | :--- |
| **Real symlink (GitHub)** | Creates/reads real OS symlinks via Node's `fs`. | No symlink API — falls back: on pull, writes the target *path* as the file content. |

## What happens per direction

### Pull (remote → vault)

- **Real** + GitHub + desktop: a remote symlink is recreated as a real OS link
  pointing at its target.
- **Real** on mobile (or if the link can't be created): the link target path is
  written into the file as its content, so it still round-trips.
- **Follow**: the target's content is written as a normal file. (For a link whose
  target is a normal in-repo file, GitHub's API already returns that content.)
- **Skip**: remote symlinks are excluded from the sync list.

### Push (vault → remote)

- **Real** + GitHub: a local symlink is committed as a real symlink blob
  (mode `120000`) using the Git Data API.
- **Skip**: local symlinks are not pushed.
- **Follow**: the content the link points to is pushed as a normal file.

#### Safety: Follow never destroys a remote symlink

A `follow` push reads *through* a local symlink and would otherwise overwrite the
remote with a regular file. To avoid silently converting a remote symlink into an
ordinary file, **if the remote path is detected as a symlink, the push is skipped
with a notice**. Use **Real symlink** (GitHub) if you actually want to manage the
link.

> Note: remote-symlink detection on push relies on the provider reporting the
> symlink type, which currently only GitHub does. On GitLab/Gitea a `follow` push
> cannot detect a remote symlink and may convert it to a regular file.

## Error handling

Earlier versions surfaced confusing errors when a symlinked `.gitignore` (or other
symlink) returned `404` during a refresh. Expected `404`s are now logged at debug
level instead of as errors, and symlinks are detected up front, so a normal
refresh/pull no longer shows spurious "Git Service Request Failed (404)" messages.
