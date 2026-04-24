# E2E Testing Conventions

## Running e2e tests

Always run `build:e2e` before `test:e2e`. The webServer in `playwright.config.ts` starts `wrangler dev` directly — it does **not** build; `dist/` must exist first:

```bash
pnpm build:e2e   # build with test-safe env vars
pnpm test:e2e    # must complete within 10 minutes (globalTimeout)
```

`build:e2e` uses test-safe env vars (Turnstile test key, dummy GA ID). Do not use `pnpm build` for e2e — it may embed production keys.

---

## When adding a new feature

Draft test cases first. Present them to the user and ask which priority level each belongs to — **wait for confirmation before writing any test files**:

| Level | Directory | Meaning |
|---|---|---|
| **p0** | `tests/e2e/p0/` | Smoke — critical path, always runs in CI |
| **p1** | `tests/e2e/p1/` | Functional — main feature behaviour |
| **p2** | `tests/e2e/p2/` | Admin / auth flows |
| **p3** | `tests/e2e/p3/` | Edge cases, secondary flows (default for new tests) |

## File & test naming

```
tests/e2e/p{N}/p{N}_{id}-{description}.spec.ts
```

`{id}` is the next sequential number in that folder. Test function names mirror it:
```ts
test("p1_007 tool stats should increment on visit", async ({ page }) => { ... });
```

Use `test.step()` to group sub-checks within one test.

## `data-testid` rules

**Static single elements** — plain kebab-case:
```astro
<button data-testid="search-button">
```

**Repeated elements in a list** — suffix with a unique id/slug:
```astro
<!-- Astro -->
<article data-testid={`blog-post-card-${post.id}`}>
```
```tsx
// React
<li data-testid={`comment-item-${comment.id}`}>
```

**Duplicate test-id problem**: a component used in multiple places (e.g. `PostCardGrid` on home and category pages) must not emit clashing ids. Accept a `testId` prop on the wrapper and let the caller scope it:
```astro
---
interface Props { testId?: string; }
const { testId } = Astro.props;
---
<div data-testid={testId}>
```

In tests, use prefix selectors to get all items in a list, then narrow:
```ts
const cards = page.locator('[data-testid^="blog-post-card-"]');
await expect(cards.first()).toBeVisible();
```

## React hydration

React components lazy-load via `IntersectionObserver`. Always wait for hydration before interacting.

**In the component** — emit `data-hydrated` using `useMounted`:
```tsx
import { useMounted } from "@/hooks/useMounted";
const mounted = useMounted();
<div data-hydrated={mounted ? "true" : "false"} data-testid="my-component">
```

**In the test** — use `waitForHydration` from `tests/e2e/helpers.ts`:
```ts
import { waitForHydration } from "../helpers";

const el = page.getByTestId("my-component");
await waitForHydration(el);   // scrolls into view + waits for data-hydrated="true"
await el.click();
```

Never click, fill, or assert on interactive state before hydration — the element exists in the DOM but event listeners aren't attached yet.
