# Database & Astro Actions

## Where mutations live

All DB mutations go through Astro Actions in `src/actions/index.ts`. Never write directly to D1 from `.astro` components or one-off API routes.

## Three rules for every action handler

**1. Guard the binding** — return a safe fallback if `DB` is absent (covers local dev without wrangler):
```ts
if (!runtime?.env?.DB) return { count: 0 };
```

**2. Wrap in try/catch** — read operations return a fallback on error, write operations may throw:
```ts
try {
  const result = await db.select()...get();
  return result || { likes: 0, views: 0 };
} catch (error) {
  console.error("D1 Error:", error);
  return { likes: 0, views: 0 }; // reads: fallback. writes: throw instead.
}
```

**3. Validate inputs with `z` from `astro:schema`** — not from `zod` directly:
```ts
import { z } from "astro:schema";
input: z.object({ slug: z.string() }),
```

## Env var access pattern

Always try runtime first, fall back to `import.meta.env`:
```ts
const SECRET = (runtime?.env?.SECRET_KEY || import.meta.env.SECRET_KEY || "").toString().trim();
```

## Soft delete

The `comments` table uses `deletedAt` timestamp — not SQL `DELETE`. Follow this pattern for any table needing trash/restore:
```ts
// soft delete
await db.update(table).set({ deletedAt: new Date() }).where(eq(table.id, id));
// restore
await db.update(table).set({ deletedAt: null }).where(eq(table.id, id));
// hard delete (admin empty trash only)
await db.delete(table).where(sql`${table.deletedAt} IS NOT NULL`);
```

## Schema changes

1. Edit `src/db/schema.ts`
2. `pnpm run db:generate` — let drizzle-kit generate the migration file in `migrations/`
3. `pnpm run db:migrate` — applies to local D1
4. Before production deploy: `wrangler d1 execute <db-name> --remote --file=migrations/<generated>.sql`
5. Then `wrangler deploy`

Skipping step 4 before step 5 will leave production without the new table/column.

**NEVER manually create files in `migrations/`.** Drizzle tracks schema state via `migrations/meta/_journal.json` and `migrations/meta/*.snapshot.json`. Hand-written SQL files are invisible to drizzle-kit and will cause journal/snapshot drift — future `db:generate` runs will produce incorrect diffs. Always go through `pnpm run db:generate`.
