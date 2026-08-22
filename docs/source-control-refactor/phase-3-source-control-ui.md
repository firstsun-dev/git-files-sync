# Phase 3 — Source Control UI

## Goal

建立 VS Code style Source Control workflow。

## Layout

```
SourceControlView
 |
 + Header
 + Filter
 + ChangeTree
 + DiffPanel
```

## Sections

- READY TO PUSH
- CHANGES
- REMOTE CHANGES
- CONFLICTS
- SYNCED

## Filter

```
All
Changes
Ready to Push
Remote Changes
Conflicts
Synced
```

## Tree View

Example:

```
▼ notes
  M daily.md
  A idea.md

▼ projects
  ! settings.md
```

## Components

```
SourceControlView
SourceControlHeader
FilterMenu
ChangeTree
ChangeItem
ChangeSection
PushButton
OperationIndicator
```

## Responsive

Desktop:
- Tree + Diff

Mobile:
- List + Detail

## Tests

- SourceControlView
- ChangeTree
- FilterMenu

Cases:

- filter switching
- selection
- push action
- operation status
