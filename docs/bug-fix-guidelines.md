# Bug Fix Guidelines

Bug fixes must preserve the architecture, not merely make the failing behavior disappear.

Read `docs/architecture.md` before changing production code that crosses module boundaries.

## Required workflow

1. **Identify the owner.** Determine which module owns the incorrect behavior using the responsibility matrix and change-placement guide in `docs/architecture.md`.
2. **Reproduce at the owning layer.** Add or update the narrowest useful test that proves the defect. Prefer unit/domain tests for policy and classification bugs; use integration/provider E2E when the defect depends on a real boundary.
3. **Fix the owner or its dependency.** Put the correction where the rule already belongs.
4. **Preserve dependency direction.** Do not bypass `SyncWorkspace`, provider interfaces, or existing application boundaries for convenience.
5. **Keep one source of truth.** Do not copy an existing status/conflict/rename/action rule into a second module.
6. **Review the diff for architecture drift.** A small bug fix should not quietly create a new cross-layer dependency or a second implementation of the same policy.

## Hard rule

> A bug fix must not introduce a new cross-layer dependency merely because it is the shortest patch.

If the correct owner cannot solve the problem cleanly, improve the boundary first or keep the workaround explicitly local and documented until a boundary fix can be made. Do not normalize a shortcut into permanent architecture.

## Common examples

| Bug | Correct place to start | Avoid |
| --- | --- | --- |
| Wrong Source Control status | sync/status classification path | UI-only remapping |
| Wrong Sync Queue direction | `ChangeActionPolicy` / intent flow | row-component conditionals |
| Wrong conflict behavior | `PushCoordinator` / `ConflictResolver` | duplicating conflict logic in application facade |
| Missing remote file | refresh/discovery path | provider call from ViewModel |
| Provider-specific API failure | concrete provider / `BaseGitService` | `serviceType` branches in UI/application |
| Wrong local pull/write | pull executor/domain | filesystem operations in UI |

## PR architecture check

Before merging a bug fix, confirm:

- [ ] Owning module was identified.
- [ ] The regression is covered at the appropriate layer.
- [ ] No new forbidden cross-layer dependency was introduced.
- [ ] No existing business rule was duplicated.
- [ ] UI did not gain provider or filesystem responsibility.
- [ ] Source Control did not bypass `SyncWorkspace`.
- [ ] Provider-specific behavior remains behind the provider abstraction.
- [ ] Architecture documentation was updated if a responsibility boundary changed.

## AI-assisted changes

When using an AI coding agent, provide or reference `docs/architecture.md` and require the agent to name the owning module before implementation.

A valid fix plan should answer these questions before code changes:

1. What module owns the bug?
2. What invariant is currently violated?
3. What test demonstrates the regression?
4. Which existing boundary will the fix use?
5. Does the fix add any new dependency edge? If yes, why is that edge architecturally valid?

Do not accept a patch solely because tests pass if it moves domain logic into UI, introduces direct provider access above `SyncWorkspace`, or duplicates an existing policy.
